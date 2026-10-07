import "dotenv/config";

import express from "express";

import { config } from "./config.js";
import { startDiscordBot } from "./discord/bot.js";
import { handleGitHubWebhook } from "./github/webhook.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "starfin-ai",
    timestamp: new Date().toISOString(),
  });
});

app.post("/webhooks/github", handleGitHubWebhook);

startDiscordBot();

app.listen(config.PORT, () => {
  console.log(`Starfin AI running on http://localhost:${config.PORT}`);
});