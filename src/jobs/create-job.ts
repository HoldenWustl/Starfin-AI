import { randomUUID } from "node:crypto";
import { saveJob } from "./job-store.js";
import { runJob } from "./run-job.js";

export type JobSource = "discord" | "github";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type JobCheckStatus = "passed" | "failed";

export interface JobCheckResult {
  name: string;
  command: string;
  status: JobCheckStatus;
  stdout: string;
  stderr: string;
}

export interface CreateJobInput {
  source: JobSource;
  task: string;
  requestedBy?: string;
  repository?: string;
  branch?: string;
  commit?: string;
}

export interface StarfinJob {
  id: string;
  source: JobSource;
  task: string;
  requestedBy?: string;
  repository?: string;
  branch?: string;
  commit?: string;
  status: JobStatus;
  checks?: JobCheckResult[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
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
    ...(input.repository !== undefined
      ? { repository: input.repository }
      : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.commit !== undefined ? { commit: input.commit } : {}),
  };

  saveJob(job);
  void runJob(job);

  console.log("New Starfin AI job:");
  console.log(job);

  return job;
}
