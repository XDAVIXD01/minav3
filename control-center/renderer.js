const dot = document.querySelector("#status-dot");
const statusText = document.querySelector("#status-text");
const detail = document.querySelector("#status-detail");
const feedback = document.querySelector("#feedback");
const errorBox = document.querySelector("#error-box");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const restartButton = document.querySelector("#restart");
let actionRunning = false;

function render(status) {
  dot.className = status.running ? "status-dot online" : "status-dot offline";
  statusText.textContent = status.running ? (status.connected ? "MINA V3 está encendida" : "MINA V3 está conectándose…") : "MINA V3 está apagada";
  detail.textContent = status.running ? status.voice : "Lista para leer tu chat con voz IA";
  feedback.textContent = status.message || "";
  errorBox.textContent = status.lastError || "";
  errorBox.hidden = !status.lastError;
  startButton.disabled = actionRunning || status.running || status.problem;
  stopButton.disabled = actionRunning || !status.running;
  restartButton.disabled = actionRunning || status.problem;
}

async function refresh() {
  try { render(await window.minaControl.status()); }
  catch { feedback.textContent = "No pude consultar el estado del bot."; }
}

async function run(action) {
  actionRunning = true;
  document.body.classList.add("working");
  startButton.disabled = stopButton.disabled = restartButton.disabled = true;
  feedback.textContent = "Procesando…";
  try { render(await window.minaControl[action]()); }
  catch (error) { feedback.textContent = `Error: ${error.message}`; }
  finally {
    actionRunning = false;
    document.body.classList.remove("working");
    await refresh();
  }
}

startButton.addEventListener("click", () => run("start"));
stopButton.addEventListener("click", () => run("stop"));
restartButton.addEventListener("click", () => run("restart"));
refresh();
setInterval(() => { if (!actionRunning) refresh(); }, 1500);
