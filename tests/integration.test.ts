import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

// Real git clones/commits/pushes; API traffic goes to a local fixture, never live services.
const supported = process.platform !== "win32";
const temp = await mkdtemp(join(tmpdir(), "starfin-integration-"));
const realGit = supported ? execFileSync("which", ["git"], { encoding: "utf8" }).trim() : "git";
const origin = join(temp, "origin.git"), seed = join(temp, "seed"), bin = join(temp, "bin");
const runGit = (args: string[], cwd?: string) => execFileSync(realGit, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let apiRequests = 0, failPR = false, aiRequests = 0, githubPosts = 0;
const api = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/chat/completions") {
    aiRequests++;
    const body = JSON.parse(raw);
    assert.equal(req.headers.authorization, "Bearer fixture-ai-key");
    assert.ok(body.tools.length >= 3);
    assert.equal(body.model, "fixture-model");
    const task = body.messages.find((m: {role: string}) => m.role === "user").content as string;
    if (task.includes("WAIT_FOR_CANCEL")) { /* signal cancellation closes this request */ return; }
    const readonly = !body.tools.some((t: { function: { name: string } }) => t.function.name === "write_file");
    const calls = body.messages.filter((m: {role: string}) => m.role === "tool").length;
    const response = (name: string, args: unknown) => ({ role: "assistant", content: null, tool_calls: [{ id: `call${calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    let message;
    if (readonly) message = calls === 0 ? response("read_file", { path: "math.cjs" }) : { role: "assistant", content: "math.cjs defines add(a,b), but currently subtracts b." };
    else if (task.includes("Repair the actual failing checks")) message = { role: "assistant", content: "Unable to repair this intentional fixture failure." };
    else if (calls === 0) message = response("read_file", { path: "math.cjs" });
    else if (calls === 1) message = response("replace_in_file", { path: "math.cjs", old_text: "a - b", new_text: task.includes("INTENTIONAL_FAILURE") ? "a * b" : "a + b" });
    else if (calls === 2) message = response("run_checks", {});
    else message = { role: "assistant", content: "Fixed add to return the sum. Ran the existing regression test." };
    res.end(JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    return;
  }
  apiRequests++;
  if (req.url === "/repos/owner/repo") { res.end(JSON.stringify({ full_name: "owner/repo", default_branch: "main", permissions: { push: true } })); return; }
  if (req.url?.startsWith("/repos/owner/repo/pulls?") && req.method === "GET") { res.end("[]"); return; }
  if (req.url === "/repos/owner/repo/pulls" && req.method === "POST") {
    githubPosts++;
    const body = JSON.parse(raw);
    assert.equal(body.base, "main"); assert.match(body.head, /^starfin\//); assert.match(body.body, /Validation/);
    if (failPR) { res.statusCode = 403; res.end('{"message":"No PR permission"}'); return; }
    res.end('{"html_url":"https://github.com/owner/repo/pull/17"}'); return;
  }
  if (req.url === "/repos/owner/repo/pulls/17/merge") {
    const body = JSON.parse(raw);
    assert.match(body.sha, /^[a-f0-9]{40}$/);
    assert.equal(body.merge_method, "squash");
    res.end(JSON.stringify({ merged: true, sha: body.sha, message: "Merged" })); return;
  }
  res.statusCode = 404; res.end('{"message":"Unknown fixture endpoint"}');
});
await new Promise<void>(resolve => api.listen(0, "127.0.0.1", resolve));
const address = api.address();
if (!address || typeof address === "string") throw new Error("No API port");
const apiBase = `http://127.0.0.1:${address.port}`;
process.env.STARFIN_DATA_DIR = join(temp, "data");
process.env.STARFIN_WORKSPACE_ROOT = join(temp, "workspaces");
process.env.STARFIN_EXECUTION_MODE = "host";
process.env.STARFIN_TARGET_REPOSITORY = "owner/repo";
process.env.STARFIN_TARGET_BRANCH = "";
process.env.AI_BASE_URL = apiBase + "/v1";
process.env.AI_API_KEY = "fixture-ai-key";
process.env.AI_MODEL = "fixture-model";
process.env.GITHUB_TOKEN = "fixture-github-token";
process.env.DISCORD_BOT_TOKEN = "fixture-discord-token";
process.env.DISCORD_ALLOWED_USER_IDS = "123";
process.env.DISCORD_ALLOWED_CHANNEL_IDS = "";
process.env.DISCORD_GUILD_ID = "";
process.env.STARFIN_JOB_TIMEOUT_MS = "120000";
process.env.GITHUB_WEBHOOK_SECRET = "fixture-webhook-secret";
if (supported) {
  await mkdir(bin); await mkdir(seed);
  runGit(["init", "--bare", "--initial-branch=main", origin]);
  runGit(["init", "--initial-branch=main", seed]);
  await writeFile(join(seed, "math.cjs"), "exports.add = (a, b) => a - b;\n");
  await writeFile(join(seed, "test.cjs"), "const {test}=require('node:test'); const assert=require('node:assert/strict'); const {add}=require('./math.cjs'); test('adds two numbers',()=>assert.equal(add(2,3),5));\n");
  await writeFile(join(seed, "README.md"), "Fixture repository\n");
  await writeFile(join(seed, ".gitignore"), ".installed\n");
  await writeFile(join(seed, ".starfin.json"), JSON.stringify({ install: [process.execPath, "-e", "if(process.env.AI_API_KEY||process.env.GITHUB_TOKEN||process.env.DISCORD_BOT_TOKEN)process.exit(2);require('node:fs').writeFileSync('.installed','yes')"], checks: [{ name: "test", command: [process.execPath, "--test", "test.cjs"] }] }));
  runGit(["add", "."], seed); runGit(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "initial broken addition"], seed);
  runGit(["remote", "add", "origin", origin], seed); runGit(["push", "origin", "main"], seed);
  // Translate the one configured GitHub URL to our local bare repository.
  const shim = `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');let args=process.argv.slice(2).map(a=>a==='https://github.com/owner/repo.git'?${JSON.stringify(origin)}:a==='protocol.file.allow=never'?'protocol.file.allow=always':a);const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`;
  await writeFile(join(bin, "git"), shim, { mode: 0o755 });
  process.env.PATH = bin + ":" + process.env.PATH;
}
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return realFetch(url.startsWith("https://api.github.com") ? apiBase + url.slice("https://api.github.com".length) : input, init);
};
const { createJob, cancelJob, stopQueue } = await import("../src/jobs/create-job.js");
const { getJob, getAllJobs } = await import("../src/jobs/job-store.js");
const { handleCommand } = await import("../src/discord/handlers.js");
const { config } = await import("../src/config.js");
const { createApp } = await import("../src/server.js");
const context = { userId: "123", roleIds: [], channelId: "456", guildId: "789" };
async function waitFor(id: string, state: "terminal" | "running" = "terminal") {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const job = getJob(id)!;
    if (state === "running" ? job.status === "running" : !["queued", "running"].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for job: ${JSON.stringify(getJob(id))}`);
}
const options = { skip: !supported };
test("Discord task -> AI file edits -> real checks -> git push -> pull request -> merge", options, async () => {
  const response = await handleCommand("fix", "Fix addition", context);
  assert.ok(response.embeds?.length);
  const job = getAllJobs()[0]!;
  const done = await waitFor(job.id);
  assert.equal(done.status, "completed", done.error ?? "");
  assert.equal(done.prUrl, "https://github.com/owner/repo/pull/17");
  assert.deepEqual(done.changedFiles, ["math.cjs"]);
  assert.equal(done.checks?.[0]?.status, "passed");
  assert.equal(done.modelCalls, 4);
  assert.equal(done.inputTokens, 400);
  assert.match(done.diff!, /a \+ b/);
  assert.equal(runGit(["show", `${done.workBranch}:math.cjs`], origin), "exports.add = (a, b) => a + b;");
  assert.equal(runGit(["show", "main:math.cjs"], origin), "exports.add = (a, b) => a - b;");
  const stored = await readFile(join(temp, "data", "jobs", `${job.id}.json`), "utf8");
  assert.equal(JSON.parse(stored).prUrl, done.prUrl);
  assert.equal(stored.includes("fixture-github-token"), false);
  assert.equal((await readdir(join(temp, "workspaces"))).length, 0);
  const logs = await handleCommand("logs", job.id.slice(0,8), context); assert.ok(logs.files?.length);
  const merge = await handleCommand("merge", job.id, context); assert.match(merge.content as string, /Merged/);
  assert.ok(getJob(job.id)?.mergedSha);
  const mergeAgain = await handleCommand("merge", job.id, context); assert.match(mergeAgain.content as string, /already merged/);
});
test("failed validation triggers repair attempts and never pushes", options, async () => {
  const before = runGit(["for-each-ref", "--format=%(refname)", "refs/heads/"], origin);
  const job = await createJob({ source: "discord", task: "INTENTIONAL_FAILURE break addition" });
  const done = await waitFor(job.id);
  assert.equal(done.status, "failed");
  assert.match(done.error!, /Verification still fails/);
  assert.equal(done.checks?.[0]?.status, "failed");
  assert.equal(done.prUrl, undefined); assert.equal(done.branchUrl, undefined);
  assert.equal(runGit(["for-each-ref", "--format=%(refname)", "refs/heads/"], origin), before);
  assert.equal(done.modelCalls, 6);
});
test("PR permission failure preserves the pushed branch and commit for recovery", options, async () => {
  failPR = true;
  try {
    const job = await createJob({ source: "discord", task: "Fix addition but fail PR" });
    const done = await waitFor(job.id);
    assert.equal(done.status, "failed"); assert.match(done.error!, /GitHub 403/);
    assert.ok(done.branchUrl); assert.ok(done.commitSha);
    assert.equal(runGit(["rev-parse", done.workBranch!], origin), done.commitSha);
  } finally { failPR = false; }
});
test("questions read code without running checks or publishing", options, async () => {
  const before = githubPosts;
  const job = await createJob({ source: "discord", mode: "ask", task: "What does add do?" });
  const done = await waitFor(job.id);
  assert.equal(done.status, "completed", done.error ?? "");
  assert.match(done.summary!, /math.cjs/); assert.equal(done.checks, undefined);
  assert.equal(githubPosts, before);
});
test("check jobs report failures without asking the model or pushing", options, async () => {
  const before = aiRequests;
  const job = await createJob({ source: "discord", mode: "check", task: "Run checks" });
  const done = await waitFor(job.id);
  assert.equal(done.status, "failed"); assert.equal(done.checks?.[0]?.status, "failed");
  assert.equal(aiRequests, before);
});
test("queue runs one job at a time and cancellation frees the runner", options, async () => {
  const hanging = await createJob({ source: "discord", mode: "ask", task: "WAIT_FOR_CANCEL" });
  await waitFor(hanging.id, "running");
  const next = await createJob({ source: "discord", mode: "ask", task: "What is math.cjs?" });
  assert.equal(getJob(next.id)?.status, "queued");
  cancelJob(hanging.id);
  assert.equal((await waitFor(hanging.id)).status, "cancelled");
  assert.equal((await waitFor(next.id)).status, "completed");
});
test("webhook rejects tampering and other repositories and deduplicates deliveries", options, async () => {
  config.STARFIN_AUTO_FIX_PUSHES = true;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as {port: number}).port;
  const url = `http://127.0.0.1:${port}/webhooks/github`;
  const commit = runGit(["rev-parse", "main"], origin);
  const send = async (body: string, signature?: string) => realFetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-github-event": "push", "x-github-delivery": "fixture-delivery", "x-hub-signature-256": signature ?? `sha256=${createHmac("sha256", "fixture-webhook-secret").update(body).digest("hex")}` }, body });
  try {
    const body = JSON.stringify({ ref: "refs/heads/main", after: commit, repository: { full_name: "owner/repo" } });
    assert.equal((await send(body, "sha256=" + "0".repeat(64))).status, 401);
    const count = getAllJobs().length;
    assert.deepEqual(await (await send(body.replace("owner/repo", "other/repo"))).json(), { ignored: true });
    assert.equal(getAllJobs().length, count);
    const first = await send(body); assert.equal(first.status, 202);
    const result = await first.json() as {jobId: string};
    const second = await send(body); assert.equal(second.status, 202);
    assert.equal((await second.json() as {jobId: string}).jobId, result.jobId);
    await waitFor(result.jobId);
  } finally { config.STARFIN_AUTO_FIX_PUSHES = false; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test.after(async () => {
  await stopQueue(); globalThis.fetch = realFetch;
  api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve()));
  await rm(temp, { recursive: true, force: true });
});
