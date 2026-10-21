import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { github, repositoryName } from "./client.js";
import { createJob } from "../jobs/create-job.js";
import { redact } from "../lib/redact.js";

export function validSignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const pushSchema = z.object({
  ref: z.string(), after: z.string().regex(/^[a-f0-9]{40}$/), deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string() }),
  pusher: z.object({ name: z.string() }).optional(),
  head_commit: z.object({ author: z.object({ email: z.string().optional() }).optional() }).nullable().optional(),
});
export async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  if (!config.STARFIN_AUTO_FIX_PUSHES) { res.status(200).json({ ignored: true, reason: "Push automation is disabled" }); return; }
  if (!Buffer.isBuffer(req.body) || !validSignature(req.body, req.get("x-hub-signature-256"), config.GITHUB_WEBHOOK_SECRET)) {
    res.status(401).json({ error: "Invalid webhook signature" }); return;
  }
  const event = req.get("x-github-event");
  if (event === "ping") { res.json({ ok: true }); return; }
  if (event !== "push") { res.json({ ignored: true }); return; }
  try {
    const parsed = pushSchema.safeParse(JSON.parse(req.body.toString("utf8")));
    if (!parsed.success) { res.status(400).json({ error: "Invalid push payload" }); return; }
    const payload = parsed.data;
    if (payload.repository.full_name.toLowerCase() !== repositoryName(config.STARFIN_TARGET_REPOSITORY).toLowerCase() || payload.deleted || /^0+$/.test(payload.after)) { res.json({ ignored: true }); return; }
    const repo = await github.repository();
    if (payload.ref !== `refs/heads/${repo.branch}` || payload.head_commit?.author?.email === "starfin-ai@users.noreply.github.com") { res.json({ ignored: true }); return; }
    const delivery = req.get("x-github-delivery");
    if (!delivery || !/^[a-zA-Z0-9-]{1,128}$/.test(delivery)) { res.status(400).json({ error: "Missing or invalid delivery ID" }); return; }
    const job = await createJob({ source: "github", mode: "fix", task: `Check ${repo.name} at ${payload.after}. Repair actual failing checks caused by this push, if any. If all checks pass, do not make speculative changes.`, commit: payload.after, requestedBy: payload.pusher?.name || "GitHub", deliveryId: delivery, ...(config.DISCORD_NOTIFICATION_CHANNEL_ID ? { channelId: config.DISCORD_NOTIFICATION_CHANNEL_ID } : {}) });
    res.status(202).json({ received: true, jobId: job.id });
  } catch (error) {
    if (error instanceof SyntaxError) { res.status(400).json({ error: "Malformed JSON" }); return; }
    console.error("Webhook failed:", redact(error));
    res.status(503).json({ error: "Unable to queue job; retry delivery later" });
  }
}
