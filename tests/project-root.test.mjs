import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const daemonPath = path.join(repositoryRoot, "scripts", "loopit-daemon.mjs");

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Loopit daemon exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // The daemon may still be binding its localhost port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Loopit daemon did not become healthy.");
}

test("daemon stores control state in a separate target project", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "loopit-target-"));
  const port = await availablePort();
  const child = spawn(process.execPath, [daemonPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LOOPIT_APP_ROOT: repositoryRoot,
      LOOPIT_PROJECT: targetRoot,
      LOOPIT_DAEMON_PORT: String(port),
    },
    stdio: "ignore",
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(targetRoot, { recursive: true, force: true });
  });

  const health = await waitForHealth(
    `http://127.0.0.1:${port}/api/health`,
    child,
  );
  assert.equal(health.appRoot, await realpath(repositoryRoot));
  assert.equal(health.projectRoot, await realpath(targetRoot));
  assert.equal(health.projectName, path.basename(targetRoot));
  assert.equal(health.runtimeAllowed, true);
  assert.equal(health.runtimeBlockedReason, null);

  const loopResponse = await fetch(`http://127.0.0.1:${port}/api/loop`);
  assert.equal(loopResponse.status, 200);
  assert.deepEqual(await loopResponse.json(), { loop: null });
  assert.equal((await stat(path.join(targetRoot, ".loopit"))).isDirectory(), true);
  assert.equal(
    (await stat(path.join(targetRoot, ".loopit", "conversations"))).isDirectory(),
    true,
  );
  assert.equal(
    (await stat(path.join(targetRoot, ".loopit", "runs"))).isDirectory(),
    true,
  );
});

test("daemon protects the Loopit source repository from runtime", async (t) => {
  const port = await availablePort();
  const child = spawn(process.execPath, [daemonPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LOOPIT_APP_ROOT: repositoryRoot,
      LOOPIT_PROJECT: repositoryRoot,
      LOOPIT_DAEMON_PORT: String(port),
    },
    stdio: "ignore",
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  const health = await waitForHealth(
    `http://127.0.0.1:${port}/api/health`,
    child,
  );
  assert.equal(health.appRoot, await realpath(repositoryRoot));
  assert.equal(health.projectRoot, await realpath(repositoryRoot));
  assert.equal(health.runtimeAllowed, false);
  assert.match(health.runtimeBlockedReason, /separate|does not contain/i);
});

test("launcher and runtime preserve the control-plane boundary", async () => {
  const [launcherSource, daemonSource, pageSource, studioSource] =
    await Promise.all([
      readFile(path.join(repositoryRoot, "scripts", "dev.mjs"), "utf8"),
      readFile(daemonPath, "utf8"),
      readFile(path.join(repositoryRoot, "app", "page.tsx"), "utf8"),
      readFile(
        path.join(repositoryRoot, "app", "components", "LoopStudio.tsx"),
        "utf8",
      ),
    ]);

  assert.match(
    launcherSource,
    /process\.env\.LOOPIT_PROJECT \|\| process\.argv\[2\] \|\| process\.cwd\(\)/,
  );
  assert.match(launcherSource, /LOOPIT_APP_ROOT: appRoot/);
  assert.match(launcherSource, /LOOPIT_PROJECT: projectRoot/);
  assert.match(launcherSource, /cwd: projectRoot/);
  assert.match(launcherSource, /cwd: appRoot/);

  assert.match(daemonSource, /!containsPath\(appRoot, projectRoot\)/);
  assert.match(daemonSource, /!containsPath\(projectRoot, appRoot\)/);
  assert.match(
    daemonSource,
    /Runtime is disabled for the Loopit control-plane repository/,
  );
  assert.match(pageSource, /process\.env\.LOOPIT_PROJECT \|\| process\.cwd\(\)/);
  assert.match(pageSource, /turbopackIgnore: true/);
  assert.match(studioSource, /Target project/);
  assert.match(studioSource, /health\?\.runtimeAllowed === false/);
});
