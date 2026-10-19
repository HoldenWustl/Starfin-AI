import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { JobCheckResult } from "../jobs/create-job.js";

const execFileAsync = promisify(execFile);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export interface Workspace {
  path: string;
  repository: string;
  branch: string;
  commit?: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

async function runCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<CommandResult> {
  const result = await execFileAsync(command, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    ...(process.platform === "win32" && command === npmCommand
      ? { shell: true }
      : {}),
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export async function createWorkspace(options: {
  repository: string;
  branch: string;
  commit?: string;
}): Promise<Workspace> {
  const path = await mkdtemp(join(tmpdir(), "starfin-ai-"));

  try {
    await runCommand("git", [
      "clone",
      "--branch",
      options.branch,
      "--single-branch",
      options.repository,
      path,
    ]);

    if (options.commit !== undefined) {
      await runCommand("git", ["checkout", options.commit], path);
    }

    return {
      path,
      repository: options.repository,
      branch: options.branch,
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    };
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}

export async function installDependencies(workspacePath: string): Promise<void> {
  const packageLockPath = join(workspacePath, "package-lock.json");

  let hasPackageLock = true;
  try {
    await access(packageLockPath);
  } catch {
    hasPackageLock = false;
  }

  await runCommand(
    npmCommand,
    hasPackageLock ? ["ci"] : ["install"],
    workspacePath
  );
}

export async function runVerificationChecks(
  workspacePath: string
): Promise<JobCheckResult[]> {
  const packageJsonPath = join(workspacePath, "package.json");
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageJson;

  const availableScripts = packageJson.scripts ?? {};
  const checksToRun = ["typecheck", "test", "build"].filter(
    (name) => availableScripts[name] !== undefined
  );

  if (checksToRun.length === 0) {
    throw new Error(
      "No verification scripts found. Expected at least one of: typecheck, test, build."
    );
  }

  const results: JobCheckResult[] = [];

  for (const checkName of checksToRun) {
    const command = `npm run ${checkName}`;

    try {
      const result = await runCommand(
        npmCommand,
        ["run", checkName],
        workspacePath
      );

      results.push({
        name: checkName,
        command,
        status: "passed",
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error) {
      const commandError = error as Error & {
        stdout?: string;
        stderr?: string;
      };

      results.push({
        name: checkName,
        command,
        status: "failed",
        stdout: commandError.stdout ?? "",
        stderr: commandError.stderr ?? commandError.message,
      });

      break;
    }
  }

  return results;
}

export async function destroyWorkspace(workspacePath: string): Promise<void> {
  await rm(workspacePath, { recursive: true, force: true });
}
