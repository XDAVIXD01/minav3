import { stat, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { settings } from "../src/config.js";
import { generateVoice, warmVoice, closeVoice } from "../src/voice.js";

try {
  const start = performance.now();
  console.log("Cargando modelo...");
  console.log(await warmVoice());
  console.log(`Carga: ${Math.round(performance.now() - start)} ms`);
  const text = "Hola, esta es una prueba de la voz de Mina.";
  const first = performance.now();
  const file = await generateVoice(text);
  const bytes = (await stat(file)).size;
  if (bytes < 1000) throw new Error("Audio vacío o incompleto.");
  console.log(`Audio válido: ${bytes} bytes; generación ${Math.round(performance.now() - first)} ms.`);
  const cachedStart = performance.now();
  const cachedFile = await generateVoice(text);
  if (!(await readFile(cachedFile)).equals(await readFile(file))) throw new Error("La caché no reutilizó el audio.");
  console.log(`Reutilización del mismo mensaje: ${Math.round(performance.now() - cachedStart)} ms.`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(settings.ffmpeg, ["-v", "error", "-i", file, "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"], { windowsHide: true });
    let bytes = 0;
    let detail = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("FFmpeg tardó demasiado.")); }, 15_000);
    child.stdout.on("data", chunk => { bytes += chunk.length; });
    child.stderr.on("data", chunk => { detail += chunk; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code || bytes < 1000) reject(new Error(detail || "No se obtuvo audio PCM válido."));
      else { console.log(`Conversión para Discord correcta: ${bytes} bytes PCM.`); resolve(); }
    });
  });
} finally { await closeVoice(); }
