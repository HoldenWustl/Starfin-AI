import { mkdtemp, mkdir, rm, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { cleanEnvironment, runProcess } from "../lib/process.js";
import { clipped, redact } from "../lib/redact.js";
import { permittedPath, safePath } from "./files.js";
import type { JobCheckResult } from "../jobs/types.js";

export interface Workspace { path: string; repository: string; branch: string; headSha: string; }
const command = z.array(z.string().min(1).max(2000)).min(1).max(50);
const runnerSchema = z.object({ install: z.union([command, z.array(command).min(1).max(20)]).optional(), checks: z.array(z.object({ name: z.string().min(1), command })).max(20).optional() }).strict();
export type RunnerPlan = { install?: string[] | string[][]; checks: { name: string; command: string[] }[] };

export async function git(args: string[], cwd?: string, signal?: AbortSignal, authenticate = false) {
  const env = cleanEnvironment();
  // Credentials exist only in the Git subprocess, never in URLs, files, or repository commands.
  if (authenticate && config.GITHUB_TOKEN) {
    env.GIT_CONFIG_COUNT = "2";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${config.GITHUB_TOKEN}`).toString("base64")}`;
    env.GIT_CONFIG_KEY_1 = "credential.helper";
    env.GIT_CONFIG_VALUE_1 = "";
  }
  return runProcess("git", ["-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=never", ...args], { ...(cwd ? { cwd } : {}), ...(signal ? { signal } : {}), env });
}
export async function createWorkspace(options: { repository: string; branch: string; commit?: string }, signal?: AbortSignal): Promise<Workspace> {
  await git(["check-ref-format", "--branch", options.branch], undefined, signal);
  await mkdir(config.STARFIN_WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  const path = await mkdtemp(join(config.STARFIN_WORKSPACE_ROOT, "job-"));
  try {
    await git(["clone", "--no-tags", "--single-branch", "--branch", options.branch, "--", `https://github.com/${options.repository}.git`, path], undefined, signal, true);
    if (options.commit) {
      if (!/^[a-f0-9]{40}$/.test(options.commit)) throw new Error("Invalid GitHub commit SHA");
      // Do not run code from a commit outside the configured branch's history.
      await git(["merge-base", "--is-ancestor", options.commit, "HEAD"], path, signal);
      await git(["checkout", "--detach", options.commit], path, signal);
    }
    const headSha = (await git(["rev-parse", "HEAD"], path, signal)).stdout.trim();
    return { ...options, path, headSha };
  } catch (error) { await destroyWorkspace(path); throw error; }
}
export async function runnerPlan(path: string): Promise<RunnerPlan> {
  const customPath = join(path, ".starfin.json");
  try {
    if ((await lstat(customPath)).isSymbolicLink()) throw new Error(".starfin.json cannot be a symlink");
    const custom = runnerSchema.parse(JSON.parse(await readFile(customPath, "utf8")));
    return { ...custom, checks: custom.checks ?? [] };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try {
    const packagePath = await safePath(path, "package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string>; packageManager?: string };
    const exists = async (file: string) => { try { await lstat(await safePath(path, file)); return true; } catch { return false; } };
    const pnpm = await exists("pnpm-lock.yaml"), yarn = await exists("yarn.lock");
    let install = ["npm", ...(await exists("package-lock.json") || await exists("npm-shrinkwrap.json") ? ["ci"] : ["install", "--package-lock=false"]), "--no-audit", "--no-fund"];
    let runner = ["npm", "run"];
    if (pnpm) { install = ["corepack", "pnpm", "install", "--frozen-lockfile"]; runner = ["corepack", "pnpm", "run"]; }
    else if (yarn) {
      install = ["corepack", "yarn", "install", pkg.packageManager?.startsWith("yarn@1.") || !pkg.packageManager ? "--frozen-lockfile" : "--immutable"];
      runner = ["corepack", "yarn", "run"];
    }
    const scripts = pkg.scripts ?? {};
    return { install, checks: ["typecheck", "lint", "test", "build"].filter(name => scripts[name]).map(name => ({ name, command: [...runner, name] })) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { checks: [] };
}
export async function executeRepositoryCommand(path: string, argv: string[], signal?: AbortSignal) {
  if (!argv.length) throw new Error("Empty runner command");
  const executable = argv[0]!;
  if (config.STARFIN_EXECUTION_MODE === "host") {
    // Host mode is for trusted repositories on a dedicated machine only.
    const windows = process.platform === "win32" && ["npm", "npx", "corepack", "pnpm", "yarn"].includes(executable);
    if (windows && argv.some(arg => /[&|<>^%!\r\n"]/.test(arg))) throw new Error("Unsafe Windows command argument; use Docker mode.");
    return runProcess(windows ? "cmd.exe" : executable, windows ? ["/d", "/s", "/c", executable, ...argv.slice(1)] : argv.slice(1), { cwd: path, ...(signal ? { signal } : {}), allowFailure: true });
  }
  const name = `starfin-${randomUUID()}`;
  const args = ["run", "--rm", "--init", "--name", name, "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2", "--mount", `type=bind,source=${path},target=/work`, "--mount", `type=bind,source=${path}/.git,target=/work/.git,readonly`, "--workdir=/work", "--env=CI=true", "--env=HOME=/tmp", "--env=npm_config_cache=/tmp/npm-cache", "--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0"];
  if (process.getuid && process.getgid) args.push("--user", `${process.getuid()}:${process.getgid()}`);
  args.push(config.STARFIN_RUNNER_IMAGE, ...argv);
  try { return await runProcess("docker", args, { ...(signal ? { signal } : {}), allowFailure: true }); }
  finally {
    // Removing the named container also stops descendants after a timeout/cancel.
    await runProcess("docker", ["rm", "-f", name], { timeout: 15000, allowFailure: true }).catch(() => undefined);
  }
}
export async function installDependencies(path: string, plan: RunnerPlan, signal?: AbortSignal): Promise<void> {
  if (!plan.install) return;
  const commands = typeof plan.install[0] === "string" ? [plan.install as string[]] : plan.install as string[][];
  for (const argv of commands) {
    const result = await executeRepositoryCommand(path, argv, signal);
    if (result.code !== 0) throw new Error(clipped(redact(`Dependency installation failed:\n${result.stderr}\n${result.stdout}`)));
  }
}
export async function runVerificationChecks(path: string, plan: RunnerPlan, signal?: AbortSignal): Promise<JobCheckResult[]> {
  if (!plan.checks.length) return [{ name: "verification", command: "none configured", status: "skipped", stdout: "No automated checks found. Add .starfin.json for custom commands.", stderr: "" }];
  const results: JobCheckResult[] = [];
  for (const check of plan.checks) {
    signal?.throwIfAborted();
    const output = await executeRepositoryCommand(path, check.command, signal);
    results.push({ name: check.name, command: check.command.join(" "), status: output.code === 0 ? "passed" : "failed", stdout: clipped(redact(output.stdout)), stderr: clipped(redact(output.stderr)) });
  }
  return results;
}
export async function changedFiles(path: string, signal?: AbortSignal): Promise<string[]> {
  const tracked = await git(["diff", "--name-only", "-z", "HEAD", "--"], path, signal);
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"], path, signal);
  return [...new Set((tracked.stdout + untracked.stdout).split("\0").filter(Boolean))];
}
export async function commitChanges(path: string, files: string[], task: string, signal?: AbortSignal): Promise<string> {
  if (!files.length) throw new Error("No files to commit");
  if (files.length > 100) throw new Error("More than 100 files changed; split this task into smaller requests.");
  for (const file of files) {
    if (!permittedPath(file) || file === ".starfin.json") throw new Error(`Refusing to publish protected file: ${file}`);
    await safePath(path, file);
  }
  await git(["add", "--", ...files], path, signal);
  await git(["diff", "--cached", "--check"], path, signal);
  await git(["-c", "user.name=Starfin AI", "-c", "user.email=starfin-ai@users.noreply.github.com", "commit", "-m", `Starfin: ${task.replace(/[\r\n]+/g, " ").slice(0, 140)}`], path, signal);
  return (await git(["rev-parse", "HEAD"], path, signal)).stdout.trim();
}
export async function destroyWorkspace(path: string): Promise<void> { await rm(path, { recursive: true, force: true, maxRetries: 3 }); }
