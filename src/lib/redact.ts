import { config } from "../config.js";
export function redact(value: unknown): string {
  let result = value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  for (const secret of [config.AI_API_KEY, config.GITHUB_TOKEN, config.DISCORD_BOT_TOKEN, config.GITHUB_WEBHOOK_SECRET]) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED]");
}
export function clipped(value: string, limit = 12000): string {
  return value.length > limit ? value.slice(0, limit) + "\n[truncated]" : value;
}
