import { EmbedBuilder } from "discord.js";
import type { BaseMessageOptions } from "discord.js";
import { config } from "../config.js";
import { createJob, cancelJob } from "../jobs/create-job.js";
import { getJob, getAllJobs, updateJob } from "../jobs/job-store.js";
import { github } from "../github/client.js";
import { complete } from "../ai/client.js";
import { runProcess } from "../lib/process.js";
import { redact, clipped } from "../lib/redact.js";
import type { StarfinJob } from "../jobs/types.js";
import { helpText } from "./commands.js";

export interface CommandContext { userId: string; roleIds: string[]; channelId: string; guildId: string | null; }
export function isAuthorized(context: CommandContext): boolean {
  if (!context.guildId) return false;
  if (config.DISCORD_GUILD_ID && context.guildId !== config.DISCORD_GUILD_ID) return false;
  if (config.DISCORD_ALLOWED_CHANNEL_IDS.length && !config.DISCORD_ALLOWED_CHANNEL_IDS.includes(context.channelId)) return false;
  return config.DISCORD_ALLOWED_USER_IDS.includes(context.userId) || context.roleIds.some(id => config.DISCORD_ALLOWED_ROLE_IDS.includes(id));
}
export function jobEmbed(job: StarfinJob): EmbedBuilder {
  const color = job.status === "failed" ? 0xef4444 : job.status === "completed" ? 0x22c55e : 0x3b82f6;
  const fields = [
    { name: "Job", value: `\`${job.id}\``, inline: false },
    ...(job.checks ? [{ name: "Checks", value: job.checks.map(c => `${c.name}: **${c.status}**`).join("\n").slice(0, 1000), inline: false }] : []),
    ...(job.changedFiles?.length ? [{ name: "Changed files", value: clipped(job.changedFiles.join("\n"), 900), inline: false }] : []),
    ...(job.prUrl ? [{ name: "Pull request", value: job.prUrl, inline: false }] : []),
    ...(job.branchUrl ? [{ name: "Branch", value: job.branchUrl, inline: false }] : []),
    ...(job.mergedSha ? [{ name: "Merged", value: `\`${job.mergedSha.slice(0,12)}\``, inline: false }] : []),
    ...(job.error ? [{ name: "Error", value: clipped(redact(job.error), 900), inline: false }] : []),
    ...(job.summary ? [{ name: "Result", value: clipped(redact(job.summary), 1000), inline: false }] : []),
  ];
  return new EmbedBuilder().setTitle(`Starfin ${job.mode}: ${job.status}`).setColor(color).setDescription(clipped(redact(job.task), 900)).addFields(fields)
    .setFooter({ text: clipped(job.logs.at(-1) || "Waiting in queue", 200) }).setTimestamp(new Date(job.updatedAt));
}
function requiredJob(value: string): StarfinJob {
  const job = value ? getJob(value) : undefined;
  if (!job) throw new Error("Job not found. Use a full ID or a unique prefix of at least six characters.");
  return job;
}
export async function handleCommand(command: string, value: string, context: CommandContext): Promise<BaseMessageOptions> {
  if (!isAuthorized(context)) throw new Error("This account/channel is not authorized. Configure allowed user or role IDs in .env.");
  if (["fix", "ask", "check"].includes(command)) {
    const job = await createJob({ source: "discord", mode: command as "fix" | "ask" | "check", task: command === "check" ? "Run repository verification checks" : value, requestedBy: context.userId, channelId: context.channelId, guildId: context.guildId! });
    return { embeds: [jobEmbed(job)] };
  }
  if (command === "status") return { embeds: [jobEmbed(requiredJob(value))] };
  if (command === "jobs") {
    const jobs = getAllJobs().filter(j => !j.guildId || j.guildId === context.guildId).slice(0, 10);
    return { content: jobs.length ? jobs.map(j => `\`${j.id.slice(0,8)}\` **${j.status}** ${clipped(j.task.replace(/\n/g, " "), 110)}`).join("\n") : "No jobs yet. Use `/starfin fix` to start." };
  }
  if (command === "logs" || command === "diff") {
    const job = requiredJob(value);
    if (command === "diff" && !job.diff) throw new Error("No committed patch is available for this job.");
    const text = command === "diff" ? job.diff! : JSON.stringify({ id: job.id, task: job.task, status: job.status, logs: job.logs, checks: job.checks, summary: job.summary, error: job.error, prUrl: job.prUrl, modelCalls: job.modelCalls, inputTokens: job.inputTokens, outputTokens: job.outputTokens }, null, 2);
    return { files: [{ attachment: Buffer.from(redact(text)), name: `starfin-${job.id}.${command === "diff" ? "patch" : "txt"}` }] };
  }
  if (command === "cancel") return { embeds: [jobEmbed(cancelJob(value))] };
  if (command === "retry") {
    const previous = requiredJob(value);
    if (["queued", "running"].includes(previous.status)) throw new Error("This job is still active. Cancel it before retrying.");
    const job = await createJob({ source: "discord", mode: previous.mode, task: previous.task, requestedBy: context.userId, channelId: context.channelId, guildId: context.guildId! });
    return { embeds: [jobEmbed(job)] };
  }
  if (command === "merge") {
    const job = requiredJob(value);
    if (job.mergedSha) return { content: `This PR was already merged: ${job.prUrl}` };
    if (job.status !== "completed" || !job.prUrl || !job.repository || !job.commitSha) throw new Error("Only completed jobs with a published PR can be merged.");
    const number = Number(job.prUrl.match(/\/pull\/(\d+)$/)?.[1]);
    if (!number) throw new Error("Invalid PR link");
    const mergedSha = await github.mergePullRequest(job.repository, number, job.commitSha);
    updateJob(job.id, { mergedSha, mergedAt: new Date().toISOString() });
    return { content: `Merged ${job.prUrl}\nCommit: \`${mergedSha}\`` };
  }
  if (command === "repo") return { content: `Repository: ${config.STARFIN_TARGET_REPOSITORY}\nBase branch: ${config.STARFIN_TARGET_BRANCH || "repository default (auto-detected)"}\nAI model: ${config.AI_MODEL}\nRunner: ${config.STARFIN_EXECUTION_MODE}` };
  if (command === "doctor") return { content: await doctor() };
  if (command === "ping" || command === "hi") return { content: "Starfin AI is online. Use `/starfin help` for commands." };
  if (command === "help") return { content: helpText };
  return { content: "Unknown command. Use `/starfin help`." };
}
export async function doctor(): Promise<string> {
  const checks: string[] = [];
  const test = async (name: string, fn: () => Promise<string>) => {
    try { checks.push(`${name}: OK ${await fn()}`); } catch (error) { checks.push(`${name}: FAILED ${clipped(redact(error), 280)}`); }
  };
  await test("Git", async () => (await runProcess("git", ["--version"])).stdout.trim());
  await test("GitHub", async () => { const r = await github.repository(); return `${r.name}, base ${r.branch}, push permission ${r.canPush ? "available" : "missing"}`; });
  await test("AI", async () => {
    const tools = [{ type: "function" as const, function: { name: "ready", description: "Report that tool calling is available", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
    await complete([{ role: "user", content: "Call the ready tool to confirm tool calling, or reply OK." }], tools);
    return config.AI_MODEL;
  });
  if (config.STARFIN_EXECUTION_MODE === "docker") {
    await test("Docker daemon", async () => (await runProcess("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 20000 })).stdout.trim());
    await test("Runner image", async () => { await runProcess("docker", ["image", "inspect", config.STARFIN_RUNNER_IMAGE], { timeout: 20000 }); return config.STARFIN_RUNNER_IMAGE; });
  } else checks.push("Runner: host mode (repository commands execute on this machine)");
  return clipped(checks.join("\n"), 1900);
}
