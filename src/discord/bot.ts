import "dotenv/config";
import { createJob } from "../jobs/create-job.js"; 

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
\`!starfin ping\`: checks if Starfin AI is online
\`!starfin help\`: shows this list
`);
  }

  if(message.content =="!starfin hi"){
    await message.reply("Hi there im Starfin's ai, what can i help you with today?");
  }
  
});



export async function startDiscordBot() {
  await discordClient.login(token);
}

