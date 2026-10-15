import { Client, Events, GatewayIntentBits, PermissionFlagsBits, type GuildTextBasedChannel } from "discord.js";
import { credentials } from "./config.js";
import { clearReader, handleMessage, readerChannel, readerStatus, skipReader, startReader, stopReader, stopReaders } from "./reader.js";
import { closeVoice, warmVoice } from "./voice.js";
import { startControl } from "./control.js";

const client = new Client({ intents: [
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
] });
client.once(Events.ClientReady, ready => {
  console.log(`MINA V3 conectada: ${ready.user.tag}`);
  void warmVoice().then(info => console.log(`Voz preparada: ${info.model} / ${info.device}`))
    .catch(error => console.error("[carga de voz]", error.message));
});
client.on(Events.MessageCreate, handleMessage);
client.on(Events.VoiceStateUpdate, (before, after) => {
  if (after.id === client.user?.id && before.channelId && !after.channelId) stopReader(after.guild.id);
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "leer") return;
  try {
    if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
      await interaction.reply({ content: "Usa este comando dentro de un servidor.", ephemeral: true });
      return;
    }
    const command = interaction.options.getSubcommand();
    if (command === "estado") {
      await interaction.reply({ content: readerStatus(interaction.guildId), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    const activeChannel = readerChannel(interaction.guildId);
    if (!channel || (activeChannel && activeChannel !== channel.id)) {
      throw new Error(activeChannel ? "Entra al canal de voz del lector para controlarlo." : "Primero entra a un canal de voz.");
    }
    if (command === "iniciar") {
      const me = await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        throw new Error("Necesito permisos Conectar y Hablar en tu canal de voz.");
      }
      const textChannel = interaction.channel as GuildTextBasedChannel;
      if (!textChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel])) {
        throw new Error("Necesito permiso para ver este chat.");
      }
      await startReader(interaction.guild, textChannel, channel);
      await interaction.editReply(`🔊 Leeré los mensajes de <#${interaction.channelId}> en <#${channel.id}> con tu voz IA.`);
    } else if (command === "detener") {
      stopReader(interaction.guildId);
      await interaction.editReply("Lectura detenida y cola vaciada.");
    } else if (command === "saltar") {
      await interaction.editReply(skipReader(interaction.guildId) ? "Mensaje interrumpido." : "No hay un mensaje en reproducción.");
    } else if (command === "limpiar") {
      await interaction.editReply(`Cola vaciada: ${clearReader(interaction.guildId)} mensajes.`);
    }
  } catch (error) {
    console.error("[comando]", error instanceof Error ? error.message : error);
    const content = "❌ " + (error instanceof Error ? error.message.slice(0, 500) : "No pude completar la acción.");
    if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => undefined);
    else await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
  }
});
client.on(Events.Error, error => console.error("[Discord]", error.message));

let stopping = false;
let controlServer: Awaited<ReturnType<typeof startControl>> | undefined;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  controlServer?.close();
  const deadline = setTimeout(() => process.exit(code), 5000);
  deadline.unref();
  stopReaders();
  client.destroy();
  await closeVoice();
  process.exit(code);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.on("unhandledRejection", error => { console.error("[fatal]", error); void shutdown(1); });
process.on("uncaughtException", error => { console.error("[fatal]", error.message); void shutdown(1); });
try {
  controlServer = await startControl(() => client.isReady(), () => void shutdown());
  await client.login(credentials().token);
} catch (error) {
  console.error("[inicio]", error instanceof Error ? error.message : error);
  await shutdown(1);
}
