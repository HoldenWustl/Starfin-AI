import "dotenv/config";
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

  if (message.content === "!starfin ping") {
    await message.reply("Starfin AI is online.");
  }
});

export async function startDiscordBot() {
  await discordClient.login(token);
}
