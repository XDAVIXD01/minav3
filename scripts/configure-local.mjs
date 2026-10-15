import { readFile, writeFile, copyFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
const original = path.resolve(root, "../discord-youtube-music-bot");
const destination = path.join(root, ".env");
try { await access(destination); throw new Error(".env ya existe; no lo sobrescribí."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const previous = parse(await readFile(path.join(original, ".env")));
const values = {
  DISCORD_TOKEN: previous.DISCORD_TOKEN || "",
  DISCORD_CLIENT_ID: previous.DISCORD_CLIENT_ID || "",
  DISCORD_GUILD_ID: previous.DISCORD_GUILD_ID || "",
  VOICE_PYTHON_PATH: previous.VOICE_PYTHON_PATH || "C:\\mina-voice-venv\\Scripts\\python.exe",
  VOICE_REFERENCE_PATH: "assets/voice/user_reference.wav",
  VOICE_DEVICE: "cuda",
  FFMPEG_PATH: previous.FFMPEG_PATH || "ffmpeg",
};
await mkdir(path.join(root, "assets", "voice"), { recursive: true });
const reference = previous.VOICE_REFERENCE_PATH
  ? path.resolve(original, previous.VOICE_REFERENCE_PATH)
  : path.join(original, "assets", "voice", "user_reference.wav");
await copyFile(reference, path.join(root, "assets", "voice", "user_reference.wav"));
await writeFile(destination, Object.entries(values).map(([key, value]) => `${key}='${value}'`).join("\n") + "\n", { mode: 0o600 });
console.log("Credenciales locales y referencia copiadas a MINA V3. CUDA configurada.");
