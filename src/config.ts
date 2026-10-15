import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
loadEnv({ path: path.join(root, ".env"), quiet: true });
export const numberSetting = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? Math.floor(value) : fallback;
};
export const settings = {
  python: process.env.VOICE_PYTHON_PATH || "C:\\mina-voice-venv\\Scripts\\python.exe",
  reference: path.resolve(root, process.env.VOICE_REFERENCE_PATH || "assets/voice/user_reference.wav"),
  ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
  device: process.env.VOICE_DEVICE || "cuda",
  startTimeout: numberSetting("VOICE_START_TIMEOUT_MS", 240_000, 10_000, 600_000),
  generationTimeout: numberSetting("VOICE_GENERATION_TIMEOUT_MS", 90_000, 5_000, 300_000),
  queueLimit: numberSetting("READER_QUEUE_LIMIT", 20, 1, 100),
  maxAge: numberSetting("READER_MAX_AGE_MS", 90_000, 5_000, 600_000),
  maxText: numberSetting("READER_MAX_TEXT", 260, 10, 1000),
};
export function credentials() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) throw new Error("Configura DISCORD_TOKEN y DISCORD_CLIENT_ID en .env.");
  return { token, clientId, guildId: process.env.DISCORD_GUILD_ID };
}
