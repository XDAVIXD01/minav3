import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { root, settings } from "./config.js";

type Info = { device: string; model: string };
type Pending = { resolve: (file: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
type Worker = { child: ChildProcessWithoutNullStreams; ready: Promise<Info>; pending: Map<string, Pending> };
const runtime = path.join(root, "runtime", `voice-${process.pid}-${randomUUID()}`);
const cache = new Map<string, Buffer>();
let cachedBytes = 0;
let worker: Worker | undefined;
let serial: Promise<unknown> = Promise.resolve();
let closed = false;
let info: Info | undefined;

export function voiceStatus(): string {
  if (closed) return "Motor cerrado";
  return info ? `${info.model} · ${info.device === "cuda" ? "GPU CUDA" : "CPU"}` : "Motor cargando / pendiente";
}

export function warmVoice(): Promise<Info> {
  if (closed) return Promise.reject(new Error("El motor se está cerrando."));
  if (worker) return worker.ready;
  if (!existsSync(settings.reference)) return Promise.reject(new Error("Falta el audio de referencia de voz."));
  const child = spawn(settings.python, ["-u", path.join(root, "scripts", "voice_worker.py")], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", MINA_VOICE_REFERENCE: settings.reference, VOICE_DEVICE: settings.device },
  });
  let resolveReady!: (info: Info) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<Info>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const current: Worker = { child, ready, pending: new Map() };
  worker = current;
  const lines = readline.createInterface({ input: child.stdout });
  const fail = (error: Error) => {
    clearTimeout(startTimer);
    rejectReady(error);
    for (const item of current.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    current.pending.clear();
    if (worker === current) { worker = undefined; info = undefined; }
    child.kill();
    lines.close();
  };
  const startTimer = setTimeout(() => fail(new Error("El modelo de voz superó el tiempo de carga.")), settings.startTimeout);
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.once("close", code => fail(new Error(`El motor de voz se cerró (${code}).`)));
  child.stderr.on("data", chunk => process.stderr.write(`[voz] ${chunk}`));
  lines.on("line", line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === "ready") {
      clearTimeout(startTimer);
      info = { device: event.device, model: event.model };
      resolveReady(info);
    } else if (event.type === "fatal") fail(new Error(event.error));
    else if (event.id) {
      const pending = current.pending.get(event.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      current.pending.delete(event.id);
      if (event.type === "done" && event.out) pending.resolve(event.out);
      else pending.reject(new Error(event.error || "No se pudo generar el audio."));
    }
  });
  return ready;
}

export function generateVoice(text: string, cancelled: () => boolean = () => false): Promise<string> {
  // Serialización global: múltiples servidores nunca pisan el mismo modelo GPU.
  const result = serial.then(async () => {
    if (closed) throw new Error("Motor cerrado.");
    if (cancelled()) throw new Error("Mensaje descartado.");
    const key = createHash("sha256").update(text).digest("hex");
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); cache.set(key, cached);
      await mkdir(runtime, { recursive: true });
      const file = path.join(runtime, `${randomUUID()}.wav`);
      await writeFile(file, cached);
      return file;
    }
    await warmVoice();
    if (cancelled()) throw new Error("Mensaje descartado.");
    await mkdir(runtime, { recursive: true });
    const current = worker!;
    const id = randomUUID();
    const out = path.join(runtime, `${id}.wav`);
    const file = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id);
        reject(new Error("La generación de voz excedió el tiempo permitido."));
        current.child.kill(); // Evita que una inferencia atascada bloquee toda la cola.
      }, settings.generationTimeout);
      current.pending.set(id, { resolve, reject, timer });
      current.child.stdin.write(JSON.stringify({ id, text, out }) + "\n", error => {
        if (error) { clearTimeout(timer); current.pending.delete(id); reject(error); }
      });
    });
    const audio = await readFile(file);
    cache.set(key, audio);
    cachedBytes += audio.length;
    // Caché acotado tanto por número de frases como por memoria (64 MiB).
    while (cache.size > 64 || cachedBytes > 64 * 1024 * 1024) {
      const oldest = cache.keys().next().value!;
      cachedBytes -= cache.get(oldest)!.length;
      cache.delete(oldest);
    }
    return file;
  });
  serial = result.catch(() => undefined);
  return result;
}

export async function releaseVoice(file: string): Promise<void> {
  if (path.dirname(file) === runtime) await rm(file, { force: true }).catch(() => undefined);
}

export async function closeVoice(): Promise<void> {
  closed = true;
  worker?.child.kill();
  await serial.catch(() => undefined);
  cache.clear();
  await rm(runtime, { recursive: true, force: true });
}
