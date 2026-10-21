import { config } from "../config.js";
import { clipped, redact } from "../lib/redact.js";

export function repositoryName(value: string): string {
  const normalized = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git\/?$/, "").replace(/\/$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(normalized) || normalized.split("/")[1] === "." || normalized.split("/")[1] === "..") {
    throw new Error("Repository must be owner/repo or https://github.com/owner/repo (no embedded credentials).");
  }
  return normalized;
}
export class GitHubClient {
  constructor(private token = config.GITHUB_TOKEN, private baseUrl = "https://api.github.com") {}
  async request<T>(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "Starfin-AI" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      redirect: "error",
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`GitHub ${response.status}: ${clipped(redact(text), 1500)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  async repository(signal?: AbortSignal) {
    const name = repositoryName(config.STARFIN_TARGET_REPOSITORY);
    const repo = await this.request<{ default_branch: string; permissions?: { push?: boolean }; full_name: string }>(`/repos/${name}`, undefined, signal);
    return { name, branch: config.STARFIN_TARGET_BRANCH || repo.default_branch, canPush: repo.permissions?.push !== false };
  }
  async openPullRequest(repository: string, branch: string, base: string, title: string, body: string, signal?: AbortSignal): Promise<string> {
    // Look up first so a retried publication reuses its existing PR.
    const owner = repository.split("/")[0];
    const query = new URLSearchParams({ head: `${owner}:${branch}`, base, state: "open" });
    const existing = await this.request<{ html_url: string }[]>(`/repos/${repository}/pulls?${query}`, undefined, signal);
    if (existing[0]) return existing[0].html_url;
    const pr = await this.request<{ html_url: string }>(`/repos/${repository}/pulls`, { title: title.slice(0, 200), head: branch, base, body }, signal);
    return pr.html_url;
  }
  async mergePullRequest(repository: string, number: number, expectedSha: string, signal?: AbortSignal): Promise<string> {
    const result = await this.request<{ merged: boolean; message: string; sha: string }>(`/repos/${repository}/pulls/${number}/merge`, { merge_method: "squash", sha: expectedSha }, signal, "PUT");
    if (!result.merged) throw new Error(`GitHub refused merge: ${result.message}`);
    return result.sha;
  }
}
export const github = new GitHubClient();
