import express from "express";
import { config, validateStartup } from "./config.js";
import { startDiscordBot, stopDiscordBot } from "./discord/bot.js";
import { handleGitHubWebhook } from "./github/webhook.js";
import { initializeStore } from "./jobs/job-store.js";
import { resumeQueue, stopQueue } from "./jobs/create-job.js";
import { repositoryName } from "./github/client.js";
import { redact } from "./lib/redact.js";

export function createApp(isReady: () => boolean = () => true) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => { res.status(isReady() ? 200 : 503).json({ ok: isReady(), service: "starfin-ai" }); });
  // Signature verification must see the exact original bytes, before JSON parsing.
  app.post("/webhooks/github", express.raw({ type: "application/json", limit: "2mb" }), handleGitHubWebhook);
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  const handler: express.ErrorRequestHandler = (error, _req, res, _next) => {
    console.error("HTTP error:", redact(error));
    res.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid request" });
  };
  app.use(handler);
  return app;
}
export async function startServer(): Promise<void> {
  validateStartup();
  repositoryName(config.STARFIN_TARGET_REPOSITORY);
  initializeStore();
  let ready = false;
  const server = createApp(() => ready).listen(config.PORT, () => console.log(`Starfin HTTP service on port ${config.PORT}`));
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("error", error => { console.error(redact(error)); process.exitCode = 1; void shutdown(); });
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    ready = false;
    server.close();
    await stopQueue();
    stopDiscordBot();
    server.closeAllConnections();
  }
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  try {
    await startDiscordBot();
    ready = true;
    resumeQueue();
    console.log("Starfin is ready. Try /starfin doctor in Discord.");
  } catch (error) { await shutdown(); throw error; }
}
