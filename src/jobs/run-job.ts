import { readText, listFiles } from "../sandbox/files.js";
import { config } from "../config.js";
import { github } from "../github/client.js";
import { runAgent } from "../ai/agent.js";
import { createWorkspace, destroyWorkspace, runnerPlan, installDependencies, runVerificationChecks, changedFiles, commitChanges, git } from "../sandbox/workspace.js";
import { clipped, redact } from "../lib/redact.js";
import { getJob, logJob, updateJob } from "./job-store.js";
import type { StarfinJob } from "./types.js";

export async function runJob(job: StarfinJob, signal: AbortSignal): Promise<void> {
  const log = (line: string) => logJob(job.id, line);
  updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });
  let path: string | undefined;
  try {
    log("Resolving GitHub repository and base branch");
    const repository = await github.repository(signal);
    updateJob(job.id, { repository: repository.name, branch: repository.branch });
    const workspace = await createWorkspace({ repository: repository.name, branch: repository.branch, ...(job.commit ? { commit: job.commit } : {}) }, signal);
    path = workspace.path;
    updateJob(job.id, { headSha: workspace.headSha });
    let plan = await runnerPlan(path);
    let installedFingerprint = "";
    const installIfNeeded = async () => {
      const manifests = (await listFiles(path!, signal)).filter(name => /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(?:\.lock)?|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|composer\.(?:json|lock)|Gemfile(?:\.lock)?)$/.test(name));
      const fingerprint = await Promise.all(manifests.map(async name => [name, await readText(path!, name)]));
      const key = JSON.stringify(fingerprint);
      if (installedFingerprint !== key) {
        plan = await runnerPlan(path!);
        if (plan.install) log(`Installing dependencies: ${plan.install.join(" ")}`);
        await installDependencies(path!, plan, signal);
        installedFingerprint = key;
      }
    };
    const verify = async () => {
      let results;
      try {
        await installIfNeeded();
        log("Running verification checks");
        results = await runVerificationChecks(path!, plan, signal);
      } catch (error) {
        signal.throwIfAborted();
        results = [{ name: "runner", command: "dependency installation / verification", status: "failed" as const, stdout: "", stderr: clipped(redact(error)) }];
      }
      updateJob(job.id, { checks: results });
      for (const check of results) log(`${check.name}: ${check.status}`);
      return results;
    };
    const usage = (input: number, output: number) => {
      const current = getJob(job.id)!;
      updateJob(job.id, { modelCalls: (current.modelCalls ?? 0) + 1, inputTokens: (current.inputTokens ?? 0) + input, outputTokens: (current.outputTokens ?? 0) + output });
    };
    if (job.mode === "ask") {
      log("Reading repository to answer question");
      const summary = await runAgent({ path, task: job.task, readOnly: true, signal, verify, log, usage });
      updateJob(job.id, { status: "completed", summary, completedAt: new Date().toISOString() });
      return;
    }
    const baseline = await verify();
    if (job.mode === "check") {
      const failed = baseline.some(c => c.status === "failed");
      updateJob(job.id, { status: failed ? "failed" : "completed", summary: baseline.map(c => `${c.name}: ${c.status}`).join("\n"), ...(failed ? { error: "Repository checks failed; see logs for output." } : {}), completedAt: new Date().toISOString() });
      return;
    }
    if (!repository.canPush) throw new Error("GitHub token has no push permission for this repository.");
    const workBranch = `starfin/${job.id}`;
    await git(["checkout", "-b", workBranch], path, signal);
    updateJob(job.id, { workBranch });
    log("AI is inspecting and editing repository files");
    let summary = await runAgent({ path, task: job.task, checks: baseline, signal, verify, log, usage });
    let checks = await verify();
    for (let attempt = 0; checks.some(c => c.status === "failed") && attempt < 2; attempt++) {
      log(`Repairing failed verification (attempt ${attempt + 1}/2)`);
      summary = await runAgent({ path, task: `Finish this task: ${job.task}\nYour previous work:\n${summary}\nRepair the actual failing checks below without weakening tests or checks.`, checks, signal, verify, log, usage });
      checks = await verify();
    }
    const files = await changedFiles(path, signal);
    updateJob(job.id, { changedFiles: files, summary });
    if (checks.some(c => c.status === "failed")) throw new Error("Verification still fails after two repair attempts; no changes were pushed.");
    if (!files.length) {
      updateJob(job.id, { status: "completed", summary: `${summary}\n\nNo code changes were needed; nothing was pushed.`, completedAt: new Date().toISOString() });
      return;
    }
    log(`Committing ${files.length} changed file(s)`);
    const commitSha = await commitChanges(path, files, job.task, signal);
    const diff = clipped(redact((await git(["show", "--no-ext-diff", "--no-textconv", "--format=", "--stat", "--patch", "HEAD"], path, signal)).stdout), 90000);
    updateJob(job.id, { commitSha, diff });
    signal.throwIfAborted();
    log(`Pushing branch ${workBranch}`);
    await git(["push", "--", `https://github.com/${repository.name}.git`, `HEAD:refs/heads/${workBranch}`], path, signal, true);
    const branchUrl = `https://github.com/${repository.name}/tree/${workBranch}`;
    updateJob(job.id, { branchUrl });
    log("Opening GitHub pull request");
    const body = `## Changes\n${summary}\n\n## Validation\n${checks.map(c => `- ${c.command}: ${c.status}`).join("\n")}\n\nRequested task: ${job.task}\n\nStarfin job: ${job.id}`;
    const prUrl = await github.openPullRequest(repository.name, workBranch, repository.branch, `Starfin: ${job.task.split("\n")[0]}`, body, signal);
    updateJob(job.id, { status: "completed", prUrl, completedAt: new Date().toISOString() });
    log(`Ready for review: ${prUrl}`);
  } catch (error) {
    const cancelled = signal.aborted && /Cancelled|shutting down/i.test(String(signal.reason));
    const message = redact(signal.aborted ? signal.reason : error);
    updateJob(job.id, { status: cancelled ? "cancelled" : "failed", error: message, completedAt: new Date().toISOString() });
    log(message);
  } finally {
    if (path && !config.STARFIN_KEEP_WORKSPACES) await destroyWorkspace(path).catch(error => log(`Workspace cleanup failed: ${redact(error)}`));
    else if (path) log(`Workspace retained: ${path}`);
  }
}
