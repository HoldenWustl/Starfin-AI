import { Client, GatewayIntentBits, Events, MessageFlags } from "discord.js";
import type { Message, BaseMessageOptions } from "discord.js";
import { config } from "../config.js";
import { commandDefinition, parsePrefix } from "./commands.js";
import { handleCommand, isAuthorized, jobEmbed } from "./handlers.js";
import { jobEvents } from "../jobs/job-store.js";
import { clipped, redact } from "../lib/redact.js";
import type { StarfinJob } from "../jobs/types.js";

export const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, ...(config.STARFIN_ENABLE_PREFIX_COMMANDS ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])], allowedMentions: { parse: [], repliedUser: false } });
const progressMessages = new Map<string, Message>();
const pending = new Map<string, StarfinJob>();
const timers = new Map<string, NodeJS.Timeout>();
const busy = new Set<string>();
const terminalNotified = new Set<string>();

async function notify(job: StarfinJob): Promise<void> {
  if (terminalNotified.has(job.id)) return;
  const channelId = job.channelId || config.DISCORD_NOTIFICATION_CHANNEL_ID;
  if (!channelId) return;
  const channel = await discordClient.channels.fetch(channelId);
  if (!channel || !channel.isSendable()) return;
  const payload: BaseMessageOptions = { embeds: [jobEmbed(job)], allowedMentions: { parse: [] } };
  const existing = progressMessages.get(job.id);
  if (existing) {
    try { await existing.edit(payload); }
    catch { progressMessages.set(job.id, await channel.send(payload)); }
  } else progressMessages.set(job.id, await channel.send(payload));
  if (!["queued", "running"].includes(job.status)) {
    terminalNotified.add(job.id);
    progressMessages.delete(job.id);
    // Full answers remain available even when they exceed the embed preview.
    if (job.summary && job.summary.length > 1000) await channel.send({ content: `Result for \`${job.id.slice(0,8)}\``, files: [{ attachment: Buffer.from(redact(job.summary)), name: `starfin-${job.id}-result.txt` }], allowedMentions: { parse: [] } });
    if (terminalNotified.size > 2000) terminalNotified.delete(terminalNotified.values().next().value!);
  }
}
function scheduleNotification(job: StarfinJob): void {
  if (!discordClient.isReady()) return;
  pending.set(job.id, job);
  if (timers.has(job.id) || busy.has(job.id)) return;
  const timer = setTimeout(() => {
    timers.delete(job.id);
    const latest = pending.get(job.id);
    pending.delete(job.id);
    if (!latest) return;
    busy.add(job.id);
    void notify(latest).catch(error => console.error("Discord notification failed:", redact(error))).finally(() => {
      busy.delete(job.id);
      const next = pending.get(job.id);
      if (next) scheduleNotification(next);
    });
  }, 1500);
  timer.unref();
  timers.set(job.id, timer);
}
jobEvents.on("updated", scheduleNotification);

discordClient.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "starfin") return;
  try {
    const member = interaction.member;
    const roleIds = member ? Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()] : [];
    const context = { userId: interaction.user.id, roleIds, channelId: interaction.channelId, guildId: interaction.guildId };
    if (!isAuthorized(context)) { await interaction.reply({ content: "This account/channel is not authorized to use Starfin.", flags: MessageFlags.Ephemeral }); return; }
    await interaction.deferReply();
    const result = await handleCommand(interaction.options.getSubcommand(), interaction.options.getString("task") || interaction.options.getString("job") || "", context);
    await interaction.editReply({ ...result, allowedMentions: { parse: [] } });
  } catch (error) {
    const content = clipped(redact(error), 1800);
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) { console.error("Discord reply failed:", redact(replyError)); }
  }
});

discordClient.on(Events.MessageCreate, async message => {
  if (message.author.bot || !config.STARFIN_ENABLE_PREFIX_COMMANDS || !message.inGuild()) return;
  const parsed = parsePrefix(message.content);
  if (!parsed) return;
  try {
    const member = message.member || await message.guild.members.fetch(message.author.id);
    const result = await handleCommand(parsed.command, parsed.value, { userId: message.author.id, roleIds: [...member.roles.cache.keys()], channelId: message.channelId, guildId: message.guildId });
    await message.reply({ ...result, allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) { await message.reply({ content: clipped(redact(error), 1800), allowedMentions: { parse: [], repliedUser: false } }).catch(() => undefined); }
});
discordClient.on(Events.Error, error => console.error("Discord error:", redact(error)));

export async function startDiscordBot(): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Discord connection timed out")), 60000);
    timeout.unref();
    discordClient.once(Events.ClientReady, client => {
      void (async () => {
        // Create/update only Starfin's command; preserve other commands on this app.
        if (config.DISCORD_GUILD_ID) await client.application.commands.create(commandDefinition.toJSON(), config.DISCORD_GUILD_ID);
        else await client.application.commands.create(commandDefinition.toJSON());
        console.log(`Discord ready as ${client.user.tag}; /starfin registered`);
      })().then(() => { clearTimeout(timeout); resolve(); }, error => { clearTimeout(timeout); reject(error); });
    });
  });
  // Attach the handler before login so failed login cannot create an unhandled ready rejection.
  const completion = Promise.all([ready, discordClient.login(config.DISCORD_BOT_TOKEN)]);
  try { await completion; } finally { if (timeout) clearTimeout(timeout); }
}
export function stopDiscordBot(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  discordClient.destroy();
}
