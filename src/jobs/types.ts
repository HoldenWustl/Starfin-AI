export type JobMode = "fix" | "check" | "ask";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface JobCheckResult {
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  stdout: string;
  stderr: string;
}
export interface CreateJobInput {
  source: "discord" | "github";
  mode?: JobMode;
  task: string;
  requestedBy?: string;
  channelId?: string;
  guildId?: string;
  commit?: string;
  deliveryId?: string;
}
export interface StarfinJob extends CreateJobInput {
  id: string;
  mode: JobMode;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  repository?: string;
  branch?: string;
  workBranch?: string;
  headSha?: string;
  checks?: JobCheckResult[];
  changedFiles?: string[];
  summary?: string;
  error?: string;
  mergedSha?: string;
  mergedAt?: string;
  prUrl?: string;
  branchUrl?: string;
  commitSha?: string;
  logs: string[];
  diff?: string;
  modelCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
}
