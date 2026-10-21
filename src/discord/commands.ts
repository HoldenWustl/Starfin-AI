import { SlashCommandBuilder } from "discord.js";
export const commandDefinition = new SlashCommandBuilder().setName("starfin").setDescription("AI engineering tasks for your GitHub repository")
  .addSubcommand(s => s.setName("fix").setDescription("Implement a task, run checks, push a branch, and open a PR").addStringOption(o => o.setName("task").setDescription("Describe the bug or feature").setRequired(true).setMaxLength(6000)))
  .addSubcommand(s => s.setName("ask").setDescription("Ask a question about the repository (read only)").addStringOption(o => o.setName("task").setDescription("Your question").setRequired(true).setMaxLength(6000)))
  .addSubcommand(s => s.setName("check").setDescription("Run the repository checks without changing code"))
  .addSubcommand(s => s.setName("status").setDescription("Show job progress and links").addStringOption(o => o.setName("job").setDescription("Job ID or unique prefix").setRequired(true)))
  .addSubcommand(s => s.setName("logs").setDescription("Download job logs, check output, and summary").addStringOption(o => o.setName("job").setDescription("Job ID or unique prefix").setRequired(true)))
  .addSubcommand(s => s.setName("diff").setDescription("Download the patch from a finished job").addStringOption(o => o.setName("job").setDescription("Job ID or unique prefix").setRequired(true)))
  .addSubcommand(s => s.setName("cancel").setDescription("Cancel a queued or running job").addStringOption(o => o.setName("job").setDescription("Job ID or unique prefix").setRequired(true)))
  .addSubcommand(s => s.setName("retry").setDescription("Create a fresh job for an earlier task").addStringOption(o => o.setName("job").setDescription("Job ID or unique prefix").setRequired(true)))
  .addSubcommand(s => s.setName("merge").setDescription("Merge this job's PR at its exact generated commit").addStringOption(o => o.setName("job").setDescription("Completed job ID or unique prefix").setRequired(true)))
  .addSubcommand(s => s.setName("jobs").setDescription("List the last ten jobs"))
  .addSubcommand(s => s.setName("repo").setDescription("Show configured repository and branch"))
  .addSubcommand(s => s.setName("doctor").setDescription("Check GitHub, AI connectivity, Git, and runner setup"))
  .addSubcommand(s => s.setName("ping").setDescription("Check that Starfin is online"))
  .addSubcommand(s => s.setName("help").setDescription("Show available commands"));

export const helpText = `**Starfin commands**
\`/starfin fix task:<request>\` implements a bug fix or feature, verifies it, pushes a new branch, and opens a PR.
\`/starfin ask task:<question>\` answers using repository code.
\`/starfin check\` runs checks only.
\`/starfin status job:<id>\` shows progress, results, and links.
\`/starfin jobs\` lists recent jobs.
\`/starfin logs job:<id>\` downloads logs and check output.
\`/starfin diff job:<id>\` downloads the resulting patch.
\`/starfin cancel job:<id>\` cancels a queued/running job.
\`/starfin retry job:<id>\` starts a new attempt from the current base branch.
\`/starfin merge job:<id>\` merges that PR through GitHub (branch rules still apply).
\`/starfin repo\`, \`/starfin doctor\`, \`/starfin ping\`, \`/starfin help\`.
Jobs run one at a time. You can use a unique ID prefix of at least six characters.
If enabled in .env, text commands use \`!starfin fix <request>\`, etc. Legacy \`!status <id>\` and \`!help\` also work.`;
export function parsePrefix(content: string): { command: string; value: string } | undefined {
  const match = content.match(/^!starfin(?:\s+([a-z]+))?(?:\s+([\s\S]*))?$/i);
  if (match) return { command: (match[1] || "help").toLowerCase(), value: (match[2] || "").trim() };
  const legacy = content.match(/^!(status|help)(?:\s+([\s\S]*))?$/i);
  return legacy ? { command: legacy[1]!.toLowerCase(), value: (legacy[2] || "").trim() } : undefined;
}
