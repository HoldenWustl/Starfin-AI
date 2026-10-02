import express from "express";
import { config } from "./config.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "starfin-ai",
    timestamp: new Date().toISOString(),
  });
});

app.post("/webhooks/github", (req, res) => {
  console.log("GitHub webhook received:");
  console.log(req.headers);
  console.log(req.body);

  res.status(200).json({ received: true });
});

app.listen(config.PORT, () => {
  console.log(`Starfin AI running on http://localhost:${config.PORT}`);
});