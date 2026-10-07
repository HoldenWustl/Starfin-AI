import "dotenv/config";
import { createJob } from "../jobs/create-job.js";
import { getJob } from "../jobs/job-store.js";

import {
  Client,
  GatewayIntentBits,
  Events,
} from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is missing");
}

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discordClient.once(Events.ClientReady, (client) => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

discordClient.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith("!starfin fix")) {
    const task = message.content.slice("!starfin fix".length).trim();

    const job = await createJob({
      source: "discord",
      task,
      requestedBy: message.author.username,
    });

    await message.reply(`
Task received
Job: ${job.id}
Status: ${job.status}
${job.task}
`);
  }

  if (message.content === "!starfin ping") {
    await message.reply("Starfin AI is online.");
  }

  if (message.content === "!starfin help") {
    await message.reply(`
**Starfin commands**
\`!starfin fix <task>\`: creates a job for the task you describe
\`!starfin status <job id>\`: checks the status of a job
\`!starfin ping\`: checks if Starfin AI is online
\`!starfin help\`: shows this list
`);
  }

  if (message.content === "!starfin hi") {
    await message.reply("Hi there im Starfin's ai, what can i help you with today?");
  }

  // ===== STATUS BLOCK (this is the part with the new console.logs) =====
  if (message.content.startsWith("!starfin status")) {
    const jobId = message.content.slice("!starfin status".length).trim();

    console.log("Looking for:", JSON.stringify(jobId));   // log #1

    if (!jobId) {
      await message.reply("Please provide a job ID, e.g. `!starfin status <job id>`");
      return;
    }

    let job;
    try {
      job = await getJob(jobId);
    } catch (err) {
      console.log("getJob threw:", err);                  // log #2
      job = null;
    }

    console.log("Result:", job);                          // log #3

    if (!job) {
      await message.reply("Job not found");
      return;
    }

    await message.reply(`
Job: ${job.id}
Status: ${job.status}
${job.task}
`);
  }
  // ===== END STATUS BLOCK =====
});

export async function startDiscordBot() {
  await discordClient.login(token);
}