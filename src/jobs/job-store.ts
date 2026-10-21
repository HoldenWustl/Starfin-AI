import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { clipped, redact } from "../lib/redact.js";
import type { StarfinJob } from "./types.js";

export const jobEvents = new EventEmitter();
const jobs = new Map<string, StarfinJob>();
const directory = join(config.STARFIN_DATA_DIR, "jobs");
let initialized = false;

export function initializeStore(): void {
  if (initialized) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(directory).filter(n => /^[a-f0-9-]+\.json$/.test(n))) {
    try {
      const job = JSON.parse(readFileSync(join(directory, name), "utf8")) as StarfinJob;
      if (!job.id || !job.status || !Array.isArray(job.logs)) throw new Error("Invalid job record");
      jobs.set(job.id, job);
      if (job.status === "running") {
        job.status = "failed";
        job.error = "Runner restarted during this job. Check any saved branch/PR before retrying.";
        job.completedAt = new Date().toISOString();
        saveJob(job);
      }
    } catch (error) { throw new Error(`Cannot load job record ${name}: ${redact(error)}`); }
  }
  initialized = true;
}
export function saveJob(job: StarfinJob): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${job.id}.json`);
  writeFileSync(file + ".tmp", JSON.stringify(job, null, 2), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  jobs.set(job.id, job);
  jobEvents.emit("updated", job);
}
export function getJob(id: string): StarfinJob | undefined {
  return jobs.get(id) ?? [...jobs.values()].filter(j => j.id.startsWith(id)).filter((_j, _i, all) => id.length >= 6 && all.length === 1)[0];
}
export function getAllJobs(): StarfinJob[] { return [...jobs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
export function updateJob(id: string, updates: Partial<StarfinJob>): StarfinJob {
  const job = jobs.get(id);
  if (!job) throw new Error("Job not found");
  const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
  saveJob(updated);
  return updated;
}
export function logJob(id: string, line: string): void {
  const job = jobs.get(id);
  if (!job) return;
  const entry = `${new Date().toISOString()} ${clipped(redact(line), 3000)}`;
  updateJob(id, { logs: [...job.logs, entry].slice(-250) });
  console.log(`[${id.slice(0,8)}] ${clipped(redact(line), 250)}`);
}
