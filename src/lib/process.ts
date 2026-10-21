import { spawn } from "node:child_process";
import { config } from "../config.js";
import { clipped, redact } from "./redact.js";

export interface ProcessResult { stdout: string; stderr: string; code: number; }
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { CI: "true", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
  for (const key of ["PATH", "SystemRoot", "COMSPEC", "PATHEXT", "TEMP", "TMP", "LANG"]) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}
export async function runProcess(command: string, args: string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number; allowFailure?: boolean;
} = {}): Promise<ProcessResult> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env ?? cleanEnvironment(),
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true,
    });
    let stdout = "", stderr = "", stopped: string | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else if (child.pid) {
            // taskkill also terminates descendants (npm/test runners) on Windows.
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
          }
        } catch { /* process already exited */ }
      };
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const onAbort = () => terminate("Command cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => terminate("Command timed out"), options.timeout ?? config.STARFIN_COMMAND_TIMEOUT_MS);
    const collect = (value: Buffer, stream: "stdout" | "stderr") => {
      if (stream === "stdout") stdout += value.toString(); else stderr += value.toString();
      if (stdout.length + stderr.length > 4 * 1024 * 1024) terminate("Command output exceeded 4 MiB");
    };
    child.stdout.on("data", value => collect(value, "stdout"));
    child.stderr.on("data", value => collect(value, "stderr"));
    const cleanup = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener("abort", onAbort); };
    child.once("error", error => { cleanup(); reject(new Error(redact(error))); });
    child.once("close", code => {
      cleanup();
      const result = { stdout, stderr, code: code ?? 1 };
      if (stopped) reject(new Error(stopped));
      else if (code !== 0 && !options.allowFailure) reject(new Error(clipped(redact(`${command} failed (${code}): ${stderr || stdout}`), 12000)));
      else resolve(result);
    });
  });
}
