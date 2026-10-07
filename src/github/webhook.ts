import type { Request, Response } from "express";
import { createJob } from "../jobs/create-job.js";

export async function handleGitHubWebhook(
  req: Request,
  res: Response
) {
  const event = req.headers["x-github-event"];

  if (event !== "push") {
    res.status(200).json({ ignored: true });
    return;
  }

  const payload = req.body;

  if (payload.ref !== "refs/heads/develop") {
    res.status(200).json({ ignored: true });
    return;
  }

  const repo = payload.repository?.full_name;
  const cloneUrl = payload.repository?.clone_url;
  const commit = payload.after;
  const author = payload.pusher?.name;

  console.log("Push to develop received:");
  console.log({
    repo,
    commit,
    author,
  });

  const job = await createJob({
    source: "github",
    task: `Check ${repo} after push ${commit}`,
    ...(author !== undefined ? { requestedBy: author } : {}),
    ...(cloneUrl !== undefined ? { repository: cloneUrl } : {}),
    branch: "develop",
    ...(commit !== undefined ? { commit } : {}),
  });

  res.status(200).json({
    received: true,
    job,
  });
}
