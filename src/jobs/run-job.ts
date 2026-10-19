import { config } from "../config.js";
import {
  createWorkspace,
  destroyWorkspace,
  installDependencies,
  runVerificationChecks,
} from "../sandbox/workspace.js";
import type { StarfinJob } from "./create-job.js";
import { updateJob } from "./job-store.js";

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim() !== ""
  ) {
    return error.stderr;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function runJob(job: StarfinJob): Promise<void> {
  const repository = job.repository ?? config.STARFIN_TARGET_REPOSITORY;
  const branch = job.branch ?? config.STARFIN_TARGET_BRANCH;

  updateJob(job.id, {
    status: "running",
    repository,
    branch,
    startedAt: new Date().toISOString(),
  });

  console.log(`Running Starfin job ${job.id}`);
  console.log(`Task: ${job.task}`);
  console.log(`Repository: ${repository}`);
  console.log(`Branch: ${branch}`);

  let workspacePath: string | undefined;

  try {
    const workspace = await createWorkspace({
      repository,
      branch,
      ...(job.commit !== undefined ? { commit: job.commit } : {}),
    });

    workspacePath = workspace.path;
    console.log(`Workspace created at ${workspace.path}`);

    console.log("Installing dependencies...");
    await installDependencies(workspace.path);

    console.log("Running repository verification checks...");
    const checks = await runVerificationChecks(workspace.path);
    const failedCheck = checks.find((check) => check.status === "failed");

    if (failedCheck !== undefined) {
      updateJob(job.id, {
        status: "failed",
        checks,
        error: `${failedCheck.command} failed`,
        completedAt: new Date().toISOString(),
      });

      console.error(`Job ${job.id} failed: ${failedCheck.command}`);
      if (failedCheck.stderr) {
        console.error(failedCheck.stderr);
      }
      return;
    }

    updateJob(job.id, {
      status: "completed",
      checks,
      completedAt: new Date().toISOString(),
    });

    console.log(`Job ${job.id} completed`);
  } catch (error) {
    const message = errorMessage(error);

    console.error(`Job ${job.id} failed:`, error);

    updateJob(job.id, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
  } finally {
    if (workspacePath !== undefined) {
      if (config.STARFIN_KEEP_WORKSPACES) {
        console.log(`Keeping workspace for debugging: ${workspacePath}`);
      } else {
        try {
          await destroyWorkspace(workspacePath);
        } catch (cleanupError) {
          console.error(
            `Failed to clean up workspace ${workspacePath}:`,
            cleanupError
          );
        }
      }
    }
  }
}
