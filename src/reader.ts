import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior, StreamType,
  createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  type AudioPlayer, type VoiceConnection,
} from "@discordjs/voice";
import type { Guild, GuildTextBasedChannel, Message, VoiceBasedChannel } from "discord.js";
import { settings } from "./config.js";
import { cleanText } from "./text.js";
import { generateVoice, warmVoice, voiceStatus, releaseVoice } from "./voice.js";

type AudioResult = { file: string } | { error: Error };
type Job = { text: string; created: number; cancelled?: boolean; audio?: Promise<AudioResult> };
type Session = {
  guild: Guild; textChannel: GuildTextBasedChannel; voiceChannel: VoiceBasedChannel;
  connection: VoiceConnection; player: AudioPlayer; jobs: Job[];
  busy: boolean; stopped: boolean; generation: number; skipped: number; activeJob?: Job;
  failures: number; noticeAt: number; ffmpeg?: ChildProcessWithoutNullStreams; file?: string;
};
const sessions = new Map<string, Session>();
const starting = new Set<string>();

function prepare(job: Job): Promise<AudioResult> {
  return job.audio ??= generateVoice(job.text, () => Boolean(job.cancelled)).then(file => ({ file }), error => ({ error }));
}
function discard(job: Job) {
  job.cancelled = true;
  if (job.audio) void job.audio.then(result => { if ("file" in result) return releaseVoice(result.file); });
}
function prefetch(session: Session) {
  while (session.jobs[0] && Date.now() - session.jobs[0].created > settings.maxAge) {
    discard(session.jobs.shift()!); session.skipped++;
  }
  if (session.jobs[0]) void prepare(session.jobs[0]);
}
async function notice(session: Session, message: string) {
  if (Date.now() - session.noticeAt < 30_000 || session.stopped) return;
  session.noticeAt = Date.now();
  await session.textChannel.send({ content: message, allowedMentions: { parse: [] } }).catch(() => undefined);
}
function cleanupAudio(session: Session) {
  const child = session.ffmpeg;
  session.ffmpeg = undefined;
  child?.kill();
  if (session.file) {
    const file = session.file;
    session.file = undefined;
    if (child && child.exitCode === null && child.signalCode === null) child.once("close", () => void releaseVoice(file));
    else void releaseVoice(file);
  }
}
function finish(session: Session, generation: number) {
  if (session.stopped || session.generation !== generation || !session.busy) return;
  cleanupAudio(session);
  if (session.activeJob) session.activeJob.cancelled = true;
  session.activeJob = undefined;
  session.generation++;
  session.busy = false;
  session.player.stop(true);
  void next(session);
}
async function next(session: Session): Promise<void> {
  if (session.busy || session.stopped) return;
  prefetch(session);
  const job = session.jobs.shift();
  if (!job) return;
  session.busy = true;
  session.activeJob = job;
  const generation = ++session.generation;
  try {
    const result = await prepare(job);
    if (session.stopped || generation !== session.generation) {
      if ("file" in result) await releaseVoice(result.file);
      return;
    }
    if ("error" in result) throw result.error;
    session.file = result.file;
    const child = spawn(settings.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-i", result.file,
      "-af", "alimiter=limit=0.95", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1",
    ], { windowsHide: true });
    session.ffmpeg = child;
    let audioError = "";
    child.stderr.on("data", chunk => { audioError = (audioError + chunk).slice(-1000); });
    child.stdout.on("error", error => console.error("[audio]", error.message));
    const failed = (error: Error) => {
      if (session.generation !== generation || session.stopped) return;
      console.error("[ffmpeg]", error.message);
      void notice(session, "⚠️ No pude reproducir un mensaje. Revisaré el siguiente.");
      finish(session, generation);
    };
    child.once("error", failed);
    child.once("close", code => { if (code) failed(new Error(audioError || `FFmpeg terminó (${code}).`)); });
    session.player.play(createAudioResource(child.stdout, { inputType: StreamType.Raw }));
    session.failures = 0;
    prefetch(session); // Prepara solo un mensaje por adelantado durante la reproducción.
  } catch (error) {
    if (session.stopped || session.generation !== generation) return;
    console.error("[lector]", error instanceof Error ? error.message : error);
    session.failures++;
    await notice(session, "⚠️ Falló la voz IA. Usa /leer estado para revisar el motor.");
    if (session.failures >= 3) {
      await session.textChannel.send("❌ La voz falló tres veces seguidas. Detuve el lector; revisa logs y vuelve a usar /leer iniciar.").catch(() => undefined);
      stopReader(session.guild.id);
    } else finish(session, generation);
  }
}

export async function startReader(guild: Guild, textChannel: GuildTextBasedChannel, voiceChannel: VoiceBasedChannel) {
  if (starting.has(guild.id)) throw new Error("Ya estoy iniciando el lector en este servidor.");
  starting.add(guild.id);
  let connection: VoiceConnection | undefined;
  try {
    await warmVoice();
    stopReader(guild.id);
    connection = joinVoiceChannel({ guildId: guild.id, channelId: voiceChannel.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    connection.on("error", error => console.error("[conexión]", error.message));
    await entersState(connection, VoiceConnectionStatus.Ready, 45_000);
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);
    const session: Session = {
      guild, textChannel, voiceChannel, connection, player, jobs: [], busy: false,
      stopped: false, generation: 0, skipped: 0, failures: 0, noticeAt: 0,
    };
    sessions.set(guild.id, session);
    player.on(AudioPlayerStatus.Idle, () => finish(session, session.generation));
    player.on("error", error => {
      console.error("[player]", error.message);
      finish(session, session.generation);
    });
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      void (async () => {
        try {
          await Promise.race([
            entersState(session.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(session.connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
          await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
        } catch { if (sessions.get(guild.id) === session) stopReader(guild.id); }
      })();
    });
  } catch (error) {
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    throw error;
  } finally { starting.delete(guild.id); }
}

export function stopReader(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.stopped = true;
  if (session.activeJob) session.activeJob.cancelled = true;
  session.generation++;
  session.jobs.forEach(discard);
  session.jobs = [];
  cleanupAudio(session);
  session.player.stop(true);
  if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
  sessions.delete(guildId);
  return true;
}
export function skipReader(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session?.busy) return false;
  finish(session, session.generation);
  return true;
}
export function clearReader(guildId: string): number {
  const session = sessions.get(guildId);
  if (!session) return 0;
  const count = session.jobs.length;
  session.jobs.forEach(discard);
  session.jobs = [];
  return count;
}
export function readerChannel(guildId: string): string | undefined { return sessions.get(guildId)?.voiceChannel.id; }
export function readerStatus(guildId: string): string {
  const session = sessions.get(guildId);
  return `Motor: ${voiceStatus()}\n${session ? `Chat: <#${session.textChannel.id}>\nVoz: <#${session.voiceChannel.id}>\nPendientes: ${session.jobs.length} · Descartados por atraso/límite: ${session.skipped}` : "Lectura desactivada en este servidor."}`;
}
export function handleMessage(message: Message): void {
  if (!message.inGuild() || message.author.bot || message.webhookId) return;
  const session = sessions.get(message.guildId);
  if (!session || session.textChannel.id !== message.channelId) return;
  const text = cleanText(message.cleanContent, settings.maxText);
  if (!text) {
    if (!message.content && !message.attachments.size && !message.stickers.size) {
      void notice(session, "⚠️ Discord no entregó el texto. Revisa que Message Content Intent esté activo en el portal del bot.");
    }
    return;
  }
  if (session.jobs.length >= settings.queueLimit) { discard(session.jobs.shift()!); session.skipped++; }
  session.jobs.push({ text, created: Date.now() });
  if (session.busy) prefetch(session);
  else void next(session);
}
export function stopReaders(): void { for (const id of [...sessions.keys()]) stopReader(id); }
