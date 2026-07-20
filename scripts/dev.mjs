#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedProject =
  process.env.LOOPIT_PROJECT || process.argv[2] || process.cwd();
const projectRoot = path.resolve(requestedProject);
const projectStats = await stat(projectRoot).catch(() => null);

if (!projectStats?.isDirectory()) {
  console.error(`Loopit target project does not exist: ${projectRoot}`);
  process.exit(1);
}

const nextCli = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
const daemonScript = path.join(appRoot, "scripts", "loopit-daemon.mjs");
const childEnv = {
  ...process.env,
  LOOPIT_APP_ROOT: appRoot,
  LOOPIT_PROJECT: projectRoot,
};

console.log(`Loopit control plane: ${appRoot}`);
console.log(`Target project: ${projectRoot}`);
if (projectRoot === appRoot) {
  console.log("Runtime is locked while the Loopit source repository is the target.");
}

const children = [
  spawn(process.execPath, [daemonScript], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  }),
  spawn(process.execPath, [nextCli, "dev", "-p", "3000"], {
    cwd: appRoot,
    env: childEnv,
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
