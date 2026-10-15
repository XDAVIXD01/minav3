import net from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";
import { root } from "./config.js";
import { voiceStatus } from "./voice.js";

const key = createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 20);
const pipeName = `\\\\.\\pipe\\minav3-${key}`;

export async function startControl(isConnected: () => boolean, shutdown: () => void): Promise<net.Server> {
  const server = net.createServer(socket => {
    let input = "";
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("error", () => undefined);
    socket.on("data", data => {
      input += data;
      if (input.length > 1000) { socket.destroy(); return; }
      if (!input.includes("\n")) return;
      try {
        const request = JSON.parse(input.split("\n")[0]);
        const result = { kind: "minav3", pid: process.pid, connected: isConnected(), voice: voiceStatus() };
        if (request.action === "status") socket.end(JSON.stringify(result) + "\n");
        else if (request.action === "shutdown") {
          socket.end(JSON.stringify({ ...result, stopping: true }) + "\n", shutdown);
        } else socket.destroy();
      } catch { socket.destroy(); }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipeName, () => { server.removeListener("error", reject); resolve(); });
  });
  server.on("error", error => console.error("[control]", error.message));
  return server;
}
