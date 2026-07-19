import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const daemonScript = path.join(root, "scripts", "loopit-daemon.mjs");

const children = [
  spawn(process.execPath, [daemonScript], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  }),
  spawn(process.execPath, [nextCli, "dev", "-p", "3000"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  }),
];

let closing = false;

function close(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill("SIGTERM"));
  setTimeout(() => process.exit(code), 100).unref();
}

children.forEach((child) => {
  child.on("exit", (code, signal) => {
    if (!closing) close(code ?? (signal === "SIGTERM" ? 0 : 1));
  });
});

process.on("SIGINT", () => close(0));
process.on("SIGTERM", () => close(0));
