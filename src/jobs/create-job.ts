import { randomUUID } from "node:crypto";
import { saveJob } from "./job-store.js";

export type JobSource = "discord" | "github";

export type JobStatus = "queued";

export interface CreateJobInput {
  source: JobSource;
  task: string;
  requestedBy?: string;
}

export interface StarfinJob {
  id: string;
  source: JobSource;
  task: string;
  requestedBy?: string;
  status: JobStatus;
  createdAt: string;
}

export async function createJob(
  input: CreateJobInput
): Promise<StarfinJob> {
  const job: StarfinJob = {
    id: randomUUID(),
    source: input.source,
    task: input.task,
    status: "queued",
    createdAt: new Date().toISOString(),

    ...(input.requestedBy !== undefined
      ? { requestedBy: input.requestedBy }
      : {}),
  };

  saveJob(job);

  console.log("New Starfin AI job:");
  console.log(job);

  return job;
}