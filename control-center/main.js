const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { createHash } = require("node:crypto");
const { promisify } = require("node:util");

const config = require("./bot-config.json");
const project = path.resolve(config.botProjectPath);
const key = createHash("sha256").update(project.toLowerCase()).digest("hex").slice(0, 20);
const pipe = `\\\\.\\pipe\\minav3-${key}`;
const entry = path.join(project, "dist", "index.js");
const logs = path.join(project, "logs");
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;
let lastMessage = "";

function request(action = "status") {
  return new Promise(resolve => {
    const socket = net.createConnection(pipe);
    let data = "";
    const timer = setTimeout(() => { socket.destroy(); resolve(undefined); }, 1000);
    socket.once("connect", () => socket.write(JSON.stringify({ action }) + "\n"));
    socket.on("data", chunk => {
      data += chunk;
      if (data.includes("\n")) {
        clearTimeout(timer);
        socket.destroy();
        try { const parsed = JSON.parse(data.split("\n")[0]); resolve(parsed.kind === "minav3" ? parsed : undefined); }
        catch { resolve(undefined); }
      }
    });
    socket.on("error", () => { clearTimeout(timer); resolve(undefined); });
    socket.on("close", () => { clearTimeout(timer); resolve(undefined); });
  });
}

function projectProblem() {
  if (!fs.existsSync(entry)) return "No encuentro el proyecto compilado de MINA V3.";
  if (!fs.existsSync(path.join(project, ".env"))) return "Falta el archivo de configuración .env.";
  if (!fs.existsSync(path.join(project, "assets", "voice", "user_reference.wav"))) return "Falta la referencia de voz.";
  return "";
}

async function status() {
  const state = await request();
  const problem = projectProblem();
  return {
    running: Boolean(state), connected: Boolean(state?.connected), pid: state?.pid,
    voice: state?.voice || "", busy, problem: Boolean(problem),
    message: problem || lastMessage || (state ? "Usa /leer iniciar en Discord para activar la lectura." : "MINA V3 está apagada."),
    lastError: "",
  };
}

async function start() {
  if (await request()) { lastMessage = "MINA V3 ya está encendida."; return; }
  const problem = projectProblem();
  if (problem) throw new Error(problem);
  fs.mkdirSync(logs, { recursive: true });
  const output = fs.openSync(path.join(logs, "minav3.log"), "w");
  const errors = fs.openSync(path.join(logs, "minav3-error.log"), "w");
  let child;
  let spawnError;
  try {
    child = spawn("node.exe", [entry], {
      cwd: project, detached: true, windowsHide: true,
      stdio: ["ignore", output, errors],
    });
    child.once("error", error => { spawnError = error; });
    child.unref();
  } finally { fs.closeSync(output); fs.closeSync(errors); }
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnError) throw spawnError;
    if (await request()) { lastMessage = "MINA V3 encendida. La voz IA se está preparando en la GPU."; return; }
    if (child.exitCode !== null) throw new Error("El bot se cerró al iniciar. Revisa logs/minav3-error.log.");
    await delay(250);
  }
  // Solo el proceso recién creado; nunca finalizar procesos por nombre.
  await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
  throw new Error("MINA V3 no respondió al iniciar. Revisa su registro de errores.");
}

async function stop() {
  const state = await request();
  if (!state) { lastMessage = "MINA V3 ya está apagada."; return; }
  await request("shutdown");
  for (let attempt = 0; attempt < 24; attempt++) {
    try { process.kill(state.pid, 0); } catch { lastMessage = "MINA V3 apagada. GPU liberada."; return; }
    await delay(250);
  }
  // PID obtenido de la comunicación exclusiva con V3, no de un archivo obsoleto.
  await exec("taskkill.exe", ["/PID", String(state.pid), "/T", "/F"], { windowsHide: true }).catch(error => {
    try { process.kill(state.pid, 0); throw error; } catch (check) { if (check === error) throw error; }
  });
  lastMessage = "MINA V3 apagada.";
}

async function action(name) {
  if (busy) return status();
  busy = true;
  try {
    if (name === "start") await start();
    if (name === "stop") await stop();
    if (name === "restart") { await stop(); await start(); lastMessage = "MINA V3 reiniciada. Preparando la voz IA…"; }
  } catch (error) { lastMessage = error.message; }
  finally { busy = false; }
  return status();
}

function createWindow(capture) {
  const window = new BrowserWindow({
    width: 860, height: 560, minWidth: 760, minHeight: 500,
    title: "Control de MINA V3", show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "mina-icon.png"), backgroundColor: "#0c101a",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.loadFile(path.join(__dirname, "index.html"));
  window.once("ready-to-show", async () => {
    window.show();
    if (capture) {
      await delay(1500);
      fs.writeFileSync(capture, (await window.webContents.capturePage()).toPNG());
      app.quit();
    }
  });
}

app.setAppUserModelId("com.xdavixd.minav3.controlcenter");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    const test = process.argv.find(arg => arg.startsWith("--self-test="))?.slice(12);
    if (test) {
      const results = [{ step: "initial", ...await status() }];
      if (results[0].running) throw new Error("Prueba cancelada: V3 ya está encendida.");
      try {
        results.push({ step: "start", ...await action("start") });
        results.push({ step: "restart", ...await action("restart") });
      } finally { results.push({ step: "stop", ...await action("stop") }); }
      fs.writeFileSync(test, JSON.stringify(results, null, 2));
      app.quit();
      return;
    }
    ipcMain.handle("mina:status", status);
    for (const name of ["start", "stop", "restart"]) ipcMain.handle(`mina:${name}`, () => action(name));
    createWindow(process.argv.find(arg => arg.startsWith("--capture-ui="))?.slice(13));
  }).catch(error => { console.error(error.message); app.exit(1); });
}
app.on("window-all-closed", () => app.quit());
