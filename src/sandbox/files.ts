import { lstat, readFile, realpath, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, relative, dirname, sep } from "node:path";
import { runProcess } from "../lib/process.js";

export function permittedPath(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name)) return false;
  const parts = name.split("/");
  if (parts.some(p => !p || p === "." || p === "..")) return false;
  return !parts.some(p => /^(?:\.git|node_modules|\.venv|vendor|\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|\.env(?!\.(?:example|sample|template)$).*)$/i.test(p))
    && !/\.(?:pem|key|p12|pfx|keystore)$/i.test(name);
}
export async function safePath(root: string, name: string): Promise<string> {
  if (!permittedPath(name)) throw new Error("Path is outside the repository or is a protected credential/dependency file.");
  const base = await realpath(root);
  const target = resolve(base, name);
  if (relative(base, target).startsWith(".." + sep) || target === base) throw new Error("Path escapes repository.");
  let current = base;
  for (const segment of name.split("/")) {
    current = resolve(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlink paths are not allowed."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
export async function listFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runProcess("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, ...(signal ? { signal } : {}) });
  return [...new Set(result.stdout.split("\0").filter(permittedPath))].sort();
}
export async function readText(root: string, name: string): Promise<string> {
  const file = await safePath(root, name);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Only text files up to 1 MiB can be read.");
  const bytes = await readFile(file);
  if (bytes.includes(0)) throw new Error("Binary files cannot be read as text.");
  return bytes.toString("utf8");
}
export async function writeText(root: string, name: string, content: string): Promise<void> {
  if (name === ".starfin.json") throw new Error("Runner configuration must be edited by the repository owner.");
  if (Buffer.byteLength(content) > 1024 * 1024 || content.includes("\0")) throw new Error("Write exceeds text file limits.");
  const target = await safePath(root, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
export async function deleteText(root: string, name: string): Promise<void> {
  if (name === ".starfin.json") throw new Error("Runner configuration is protected.");
  await readText(root, name);
  await unlink(await safePath(root, name));
}
