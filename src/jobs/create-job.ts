import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { redact } from "../lib/redact.js";
import { getAllJobs, getJob, initializeStore, saveJob, updateJob, logJob } from "./job-store.js";
import { runJob } from "./run-job.js";
import type { CreateJobInput, StarfinJob } from "./types.js";
export type { StarfinJob, JobCheckResult, JobStatus, CreateJobInput } from "./types.js";

let active: { id: string; controller: AbortController } | undefined;
let pumping = false;
let stopping = false;
let scheduled = false;
export async function createJob(input: CreateJobInput): Promise<StarfinJob> {
  initializeStore();
  if (stopping) throw new Error("Starfin is shutting down; try again after restart.");
  if (!input.task.trim() || input.task.length > 12000) throw new Error("Give a task between 1 and 12,000 characters.");
  if (input.deliveryId) {
    const existing = getAllJobs().find(j => j.deliveryId === input.deliveryId);
    if (existing) return existing;
  }
  if (getAllJobs().filter(j => j.status === "queued" || j.status === "running").length >= config.STARFIN_MAX_QUEUE) throw new Error("Job queue is full. Wait for a job to finish.");
  const now = new Date().toISOString();
  const job: StarfinJob = { ...input, task: redact(input.task.trim()), mode: input.mode ?? "fix", id: randomUUID(), status: "queued", createdAt: now, updatedAt: now, logs: [] };
  saveJob(job);
  resumeQueue();
  return job;
}
export function resumeQueue(): void {
  if (scheduled || stopping) return;
  scheduled = true;
  setImmediate(() => { scheduled = false; void pump().catch(error => console.error("Queue error:", redact(error))); });
}
async function pump(): Promise<void> {
  if (pumping || stopping) return;
  pumping = true;
  try {
    while (!stopping) {
      const job = getAllJobs().reverse().find(j => j.status === "queued");
      if (!job) break;
      const controller = new AbortController();
      active = { id: job.id, controller };
      const timeout = setTimeout(() => controller.abort(new Error("Job exceeded its time limit")), config.STARFIN_JOB_TIMEOUT_MS);
      try { await runJob(job, controller.signal); }
      catch (error) { updateJob(job.id, { status: "failed", error: redact(error), completedAt: new Date().toISOString() }); }
      finally { clearTimeout(timeout); active = undefined; }
    }
  } finally { pumping = false; }
}
export function cancelJob(id: string): StarfinJob {
  const job = getJob(id);
  if (!job) throw new Error("Job not found; use the full ID or a unique prefix of at least six characters.");
  if (!["queued", "running"].includes(job.status)) throw new Error(`Job is already ${job.status}.`);
  if (active?.id === job.id) {
    logJob(job.id, "Cancellation requested");
    active.controller.abort(new Error("Cancelled from Discord"));
    return getJob(job.id)!;
  }
  return updateJob(job.id, { status: "cancelled", completedAt: new Date().toISOString() });
}
export async function stopQueue(): Promise<void> {
  stopping = true;
  active?.controller.abort(new Error("Runner shutting down"));
  const deadline = Date.now() + 20000;
  while (pumping && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
}
