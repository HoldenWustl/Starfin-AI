import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";

const temp = await mkdtemp(join(tmpdir(), "starfin-unit-"));
process.env.STARFIN_DATA_DIR = join(temp, "data");
process.env.STARFIN_EXECUTION_MODE = "host";
process.env.DISCORD_ALLOWED_USER_IDS = "111";
process.env.DISCORD_ALLOWED_ROLE_IDS = "222";
process.env.DISCORD_ALLOWED_CHANNEL_IDS = "333";
process.env.DISCORD_GUILD_ID = "444";
process.env.AI_API_KEY = "sk-unit-secret-012345678901234567890";
process.env.GITHUB_TOKEN = "github_pat_unit_secret_012345678901234";
const { permittedPath, safePath, readText, writeText } = await import("../src/sandbox/files.js");
const { validSignature } = await import("../src/github/webhook.js");
const { repositoryName } = await import("../src/github/client.js");
const { isAuthorized, handleCommand } = await import("../src/discord/handlers.js");
const { parsePrefix, commandDefinition } = await import("../src/discord/commands.js");
const { runProcess } = await import("../src/lib/process.js");
const { redact } = await import("../src/lib/redact.js");
const { config } = await import("../src/config.js");
const { cleanEnvironment } = await import("../src/lib/process.js");
const { runnerPlan, executeRepositoryCommand } = await import("../src/sandbox/workspace.js");
const { runAgent } = await import("../src/ai/agent.js");
const context = { userId: "111", roleIds: [], guildId: "444", channelId: "333" };

test("repository names accept GitHub URLs and reject credentials/options/other hosts", () => {
  assert.equal(repositoryName("https://github.com/HoldenWustl/Starfin-AI.git"), "HoldenWustl/Starfin-AI");
  assert.equal(repositoryName("owner/repo"), "owner/repo");
  for (const name of ["https://evil.test/a/b", "https://token@github.com/a/b", "--upload-pack=x/y", "../repo", "owner/..", "file:///tmp/repo"]) assert.throws(() => repositoryName(name));
});
test("paths protect credentials, prevent traversal, and reject symlink escapes", async () => {
  for (const name of ["../outside", "/etc/passwd", "src/../../a", ".git/config", ".env", "src/.env.production", "key.pem", ".npmrc", "a\\b", "node_modules/pkg/x"]) assert.equal(permittedPath(name), false, name);
  assert.equal(permittedPath(".env.example"), true);
  const root = join(temp, "files"); await mkdir(root);
  await writeText(root, "src/hello.ts", "hello\n");
  assert.equal(await readText(root, "src/hello.ts"), "hello\n");
  await assert.rejects(writeText(root, ".starfin.json", "{}"), /configuration/);
  if (process.platform !== "win32") {
    await symlink(tmpdir(), join(root, "outside"));
    await assert.rejects(safePath(root, "outside/x"), /Symlink/);
  }
});
test("webhook signatures authenticate exact bytes", () => {
  const body = Buffer.from('{"test":true}');
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(validSignature(body, signature, "secret"), true);
  assert.equal(validSignature(Buffer.from("changed"), signature, "secret"), false);
  assert.equal(validSignature(body, signature, ""), false);
  assert.equal(validSignature(body, "sha256=bad", "secret"), false);
});
test("Discord requires an allowed account/role, server, and channel", async () => {
  assert.equal(isAuthorized(context), true);
  assert.equal(isAuthorized({ ...context, userId: "999", roleIds: ["222"] }), true);
  for (const change of [{ userId: "999" }, { guildId: null }, { guildId: "999" }, { channelId: "999" }]) assert.equal(isAuthorized({ ...context, ...change }), false);
  await assert.rejects(handleCommand("fix", "change code", { ...context, userId: "999" }), /authorized/);
});
test("ping replies that Starfin is online and ends with a thumbs up", async () => {
  const response = await handleCommand("ping", "", context);
  assert.match(response.content as string, /^Starfin AI is online\..*👍$/);
});
test("prefix commands parse complete tasks without accepting near matches", () => {
  assert.deepEqual(parsePrefix("!starfin fix add a test\nfor the bug"), { command: "fix", value: "add a test\nfor the bug" });
  assert.deepEqual(parsePrefix("!status abc123"), { command: "status", value: "abc123" });
  assert.equal(parsePrefix("!starfin fixture" )?.command, "fixture");
  assert.equal(parsePrefix("!starfinance fix code"), undefined);
  assert.equal(commandDefinition.toJSON().options?.length, 14);
});
test("repository subprocesses do not inherit bot credentials", async () => {
  const result = await runProcess(process.execPath, ["-e", "console.log(JSON.stringify({ai:process.env.AI_API_KEY,gh:process.env.GITHUB_TOKEN,discord:process.env.DISCORD_BOT_TOKEN,ci:process.env.CI}))"]);
  assert.deepEqual(JSON.parse(result.stdout), { ci: "true" });
});
test("subprocess abort and timeout stop execution", async () => {
  const controller = new AbortController();
  const task = runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(task, /cancelled/);
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 80 }), /timed out/);
});
test("runner selects npm, pnpm and custom check commands", async () => {
  const root = join(temp, "plan"); await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc" } }));
  await writeFile(join(root, "package-lock.json"), "{}");
  let plan = await runnerPlan(root);
  assert.equal(plan.install?.[1], "ci");
  assert.deepEqual(plan.checks.map(c => c.name), ["typecheck", "test"]);
  await writeFile(join(root, "pnpm-lock.yaml"), "");
  plan = await runnerPlan(root); assert.equal(plan.install?.[1], "pnpm");
  await writeFile(join(root, ".starfin.json"), JSON.stringify({ checks: [{ name: "python", command: ["python", "-m", "pytest"] }] }));
  assert.deepEqual((await runnerPlan(root)).checks[0]?.command, ["python", "-m", "pytest"]);
});
test("read-only agent rejects edit calls and cannot mutate files", async () => {
  const root = join(temp, "readonly"); await mkdir(root);
  await runProcess("git", ["init", "-q", root]);
  await writeFile(join(root, "README.md"), "Original");
  let calls = 0;
  await runAgent({ path: root, task: "Explain", readOnly: true, verify: async () => [], log: () => {}, completion: async (messages, tools) => {
    assert.equal(tools.some(t => t.function.name === "write_file"), false);
    calls++;
    if (calls === 1) return { message: { role: "assistant", content: null, tool_calls: [{ id: "bad", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "README.md", content: "Changed" }) } }] }, inputTokens: 0, outputTokens: 0 };
    assert.match(messages.at(-1)?.content || "", /unavailable/);
    return { message: { role: "assistant", content: "Read only." }, inputTokens: 0, outputTokens: 0 };
  } });
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "Original");
});
test("secret redaction removes configured and recognizable tokens", () => {
  const result = redact(`${process.env.AI_API_KEY} ${process.env.GITHUB_TOKEN}`);
  assert.equal(result, "[REDACTED] [REDACTED]");
});
test("interrupted jobs are recovered from disk without rerunning them", async () => {
  const directory = join(temp, "restart"); await mkdir(join(directory, "jobs"), { recursive: true });
  const record = { id: "12345678-1234-1234-1234-123456789abc", status: "running", mode: "fix", source: "discord", task: "Interrupted task", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), logs: [] };
  await writeFile(join(directory, "jobs", `${record.id}.json`), JSON.stringify(record));
  const url = pathToFileURL(join(process.cwd(), "src/jobs/job-store.ts")).href;
  const source = `const {initializeStore,getJob}=await import(${JSON.stringify(url)});initializeStore();console.log(JSON.stringify(getJob(${JSON.stringify(record.id)})))`;
  const output = await runProcess(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { env: { ...cleanEnvironment(), STARFIN_DATA_DIR: directory } });
  const recovered = JSON.parse(output.stdout);
  assert.equal(recovered.status, "failed"); assert.match(recovered.error, /restarted/);
  assert.ok(recovered.completedAt);
  assert.equal(JSON.parse(await readFile(join(directory, "jobs", `${record.id}.json`), "utf8")).status, "failed");
});
test("Docker runner mounts Git metadata read-only and excludes secrets/socket", { skip: process.platform === "win32" }, async () => {
  const bin = join(temp, "docker-bin"), outputFile = join(temp, "docker-args.json"); await mkdir(bin);
  const source = `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='run')fs.writeFileSync(${JSON.stringify(outputFile)},JSON.stringify({args:process.argv.slice(2),ai:process.env.AI_API_KEY,gh:process.env.GITHUB_TOKEN}));\n`;
  await writeFile(join(bin, "docker"), source, { mode: 0o755 });
  const originalPath = process.env.PATH, originalMode = config.STARFIN_EXECUTION_MODE;
  process.env.PATH = bin + ":" + originalPath; config.STARFIN_EXECUTION_MODE = "docker";
  try {
    await executeRepositoryCommand(temp, ["node", "--test"]);
    const invocation = JSON.parse(await readFile(outputFile, "utf8"));
    assert.ok(invocation.args.includes(`type=bind,source=${temp}/.git,target=/work/.git,readonly`));
    assert.ok(invocation.args.includes("--cap-drop=ALL"));
    assert.equal(invocation.ai, undefined); assert.equal(invocation.gh, undefined);
    assert.equal(invocation.args.join(" ").includes("docker.sock"), false);
  } finally { process.env.PATH = originalPath; config.STARFIN_EXECUTION_MODE = originalMode; }
});
test.after(async () => { await rm(temp, { recursive: true, force: true }); });
