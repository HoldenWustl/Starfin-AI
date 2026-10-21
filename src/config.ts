import "dotenv/config";
import { z } from "zod";
import { resolve } from "node:path";

const flag = (value: string | undefined, fallback = false) => value === undefined || value === "" ? fallback : value === "true";
const ids = (value: string | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  AI_MODEL: z.string().default("gpt-4.1"),
  AI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  STARFIN_MAX_STEPS: z.coerce.number().int().min(1).max(150).default(50),
  STARFIN_JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(1800000),
  STARFIN_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300000),
  STARFIN_MAX_QUEUE: z.coerce.number().int().min(1).default(20),
}).parse(process.env);

export const config = {
  ...env,
  AI_API_KEY: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "",
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || "",
  DISCORD_ALLOWED_USER_IDS: ids(process.env.DISCORD_ALLOWED_USER_IDS),
  DISCORD_ALLOWED_ROLE_IDS: ids(process.env.DISCORD_ALLOWED_ROLE_IDS),
  DISCORD_ALLOWED_CHANNEL_IDS: ids(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
  DISCORD_NOTIFICATION_CHANNEL_ID: process.env.DISCORD_NOTIFICATION_CHANNEL_ID || "",
  STARFIN_TARGET_REPOSITORY: process.env.STARFIN_TARGET_REPOSITORY || "",
  STARFIN_TARGET_BRANCH: process.env.STARFIN_TARGET_BRANCH || "",
  STARFIN_DATA_DIR: resolve(process.env.STARFIN_DATA_DIR || "./data"),
  STARFIN_WORKSPACE_ROOT: resolve(process.env.STARFIN_WORKSPACE_ROOT || "./workspaces"),
  STARFIN_KEEP_WORKSPACES: flag(process.env.STARFIN_KEEP_WORKSPACES),
  STARFIN_ENABLE_PREFIX_COMMANDS: flag(process.env.STARFIN_ENABLE_PREFIX_COMMANDS),
  STARFIN_AUTO_FIX_PUSHES: flag(process.env.STARFIN_AUTO_FIX_PUSHES),
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || "",
  STARFIN_EXECUTION_MODE: process.env.STARFIN_EXECUTION_MODE || "docker",
  STARFIN_RUNNER_IMAGE: process.env.STARFIN_RUNNER_IMAGE || "node:24-bookworm",
};

export function validateStartup(): void {
  for (const key of ["AI_API_KEY", "GITHUB_TOKEN", "DISCORD_BOT_TOKEN", "STARFIN_TARGET_REPOSITORY"] as const) {
    if (!config[key]) throw new Error(`${key} is required; copy .env.example to .env and fill it in.`);
  }
  if (!config.DISCORD_ALLOWED_USER_IDS.length && !config.DISCORD_ALLOWED_ROLE_IDS.length) {
    throw new Error("Set DISCORD_ALLOWED_USER_IDS or DISCORD_ALLOWED_ROLE_IDS so only your team can run jobs.");
  }
  if (!["docker", "host"].includes(config.STARFIN_EXECUTION_MODE)) throw new Error("STARFIN_EXECUTION_MODE must be docker or host.");
  const url = new URL(config.AI_BASE_URL);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("AI_BASE_URL must use HTTPS (except localhost).");
  if (config.STARFIN_AUTO_FIX_PUSHES && !config.GITHUB_WEBHOOK_SECRET) throw new Error("Auto-fix webhooks require GITHUB_WEBHOOK_SECRET.");
}
