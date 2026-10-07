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

export function updateJob(
  id: string,
  updates: Partial<StarfinJob>
): StarfinJob | undefined {
  const job = jobs.get(id);

  if (!job) {
    return undefined;
  }

  const updatedJob: StarfinJob = {
    ...job,
    ...updates,
  };

  jobs.set(id, updatedJob);

  return updatedJob;
}