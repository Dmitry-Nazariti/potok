import { spawn } from "node:child_process";
import http from "node:http";
import { loadEnv, port } from "./config.js";
import { ensureStrategy } from "./db.js";
import { handleRequest } from "./server.js";

loadEnv();
ensureStrategy();

const listenPort = port();
const server = http.createServer(handleRequest);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Порт ${listenPort} занят. Закройте другой запущенный Поток или задайте POTOK_PORT.`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

server.listen(listenPort, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${listenPort}`;
  console.log("");
  console.log("  Поток запущен");
  console.log(`  ${url}`);
  console.log("  Данные лежат в data/potok.sqlite и никуда не отправляются.");
  console.log("  Остановка: Ctrl+C");
  console.log("");
  if (process.env.POTOK_OPEN === "1" && process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
});
