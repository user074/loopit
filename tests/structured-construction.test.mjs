import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseLoopMarkdown } from "../lib/loop-markdown.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const daemonPath = path.join(repositoryRoot, "scripts", "loopit-daemon.mjs");
const fixture = parseLoopMarkdown(
  await readFile(
    path.join(repositoryRoot, "tests", "fixtures", "example-loop.md"),
    "utf8",
  ),
);

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

async function waitUntilReady(port, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Test daemon exited early.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/loop`);
      if (response.ok) return;
    } catch {
      // The daemon may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test daemon did not start.");
}

test("construction serializes valid output and preserves it after invalid output", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "loopit-structured-"));
  const fakeBin = path.join(targetRoot, "fake-bin");
  await mkdir(fakeBin);
  const fakeCodex = path.join(fakeBin, "codex");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  if (process.argv.includes("--version")) {
    process.stdout.write("codex-cli test\\n");
    return;
  }
  const result = prompt.includes("invalid kind")
    ? process.env.FAKE_INVALID_RESULT
    : process.env.FAKE_VALID_RESULT;
  const events = [
    { type: "thread.started", thread_id: "00000000-0000-4000-8000-000000000001" },
    { type: "item.started", item: { type: "command_execution", command: "rg --files" } },
    { type: "item.completed", item: { type: "command_execution", command: "rg --files" } },
    { type: "item.completed", item: { type: "agent_message", text: result } }
  ];
  for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
});
`,
    "utf8",
  );
  await chmod(fakeCodex, 0o755);

  const validResult = {
    action: "update",
    message: "A valid loop is ready.",
    loop: { ...fixture, revision: 99 },
  };
  const invalidLoop = structuredClone(fixture);
  invalidLoop.states[0].kind = "authoritative";
  const invalidResult = {
    action: "update",
    message: "This invalid loop must not replace the valid revision.",
    loop: invalidLoop,
  };
  const port = await availablePort();
  const child = spawn(process.execPath, [daemonPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      LOOPIT_APP_ROOT: repositoryRoot,
      LOOPIT_PROJECT: targetRoot,
      LOOPIT_DAEMON_PORT: String(port),
      FAKE_VALID_RESULT: JSON.stringify(validResult),
      FAKE_INVALID_RESULT: JSON.stringify(invalidResult),
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

  await waitUntilReady(port, child);
  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex", message: "create a valid loop" }),
  });
  assert.equal(firstResponse.status, 200);
  const firstEvents = await firstResponse.text();
  assert.match(firstEvents, /Inspecting project files/);
  assert.match(firstEvents, /rg --files/);
  assert.match(firstEvents, /Saved canonical loop revision 1/);
  assert.match(firstEvents, /A valid loop is ready/);

  const loopPath = path.join(targetRoot, ".loopit", "loop.md");
  const validLoop = parseLoopMarkdown(await readFile(loopPath, "utf8"));
  assert.equal(validLoop.revision, 1);

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex", message: "use an invalid kind" }),
  });
  assert.equal(secondResponse.status, 200);
  const secondEvents = await secondResponse.text();
  assert.match(secondEvents, /must be one of/);

  const preservedLoop = parseLoopMarkdown(await readFile(loopPath, "utf8"));
  assert.equal(preservedLoop.revision, 1);
  assert.equal(preservedLoop.states[0].kind, fixture.states[0].kind);
});
