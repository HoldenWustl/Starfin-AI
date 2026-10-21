import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";
const readline = createInterface({ input, output });
try {
  let existing = "";
  try { existing = await readFile(".env", "utf8"); } catch { /* first run */ }
  const values = parse(existing);
  console.log("Starfin setup. Values are stored in .env, which is excluded from Git.");
  const questions: [string, string, string][] = [
    ["AI_API_KEY", "OpenAI API key (or an OpenAI-compatible provider's key)", ""],
    ["AI_MODEL", "Model name", "gpt-4.1"],
    ["AI_BASE_URL", "API base URL", "https://api.openai.com/v1"],
    ["GITHUB_TOKEN", "GitHub token (Contents + Pull requests: read/write)", ""],
    ["STARFIN_TARGET_REPOSITORY", "Target GitHub repository, owner/repo", ""],
    ["DISCORD_BOT_TOKEN", "Discord bot token", ""],
    ["DISCORD_ALLOWED_USER_IDS", "Your Discord user ID (comma separate teammates)", ""],
    ["DISCORD_GUILD_ID", "Discord server ID (recommended for immediate commands; Enter to skip)", ""],
  ];
  for (const [key, label, fallback] of questions) {
    if (values[key]) { console.log(`${key}: keeping existing value`); continue; }
    const value = (await readline.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
    if (!value && key !== "DISCORD_GUILD_ID") throw new Error(`${key} cannot be empty. Run setup again.`);
    if (/[\r\n"\\]/.test(value)) throw new Error(`Unsupported character in ${key}; edit .env manually.`);
    values[key] = value;
  }
  const lines = Object.entries(values).map(([key, value]) => `${key}="${value}"`);
  await writeFile(".env", lines.join("\n") + "\n", { mode: 0o600 });
  console.log("Saved. Start Docker Desktop / Docker Engine, then run npm start. In Discord, use /starfin doctor.");
} catch (error) { console.error(error instanceof Error ? error.message : "Setup failed"); process.exitCode = 1; }
finally { readline.close(); }
