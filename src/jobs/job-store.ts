import type { StarfinJob } from "./create-job.js";

const jobs = new Map<string, StarfinJob>();

export function saveJob(job: StarfinJob): void {
  jobs.set(job.id, job);
}

export function getJob(id: string): StarfinJob | undefined {
  return jobs.get(id);
}

export function getAllJobs(): StarfinJob[] {
  return Array.from(jobs.values());
}