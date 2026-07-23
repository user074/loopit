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
  const invocationPath = path.join(targetRoot, "codex-invocations.jsonl");
  await mkdir(fakeBin);
  const fakeCodex = path.join(fakeBin, "codex");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
const fs = require("node:fs");
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  if (process.argv.includes("--version")) {
    process.stdout.write("codex-cli test\\n");
    return;
  }
  fs.appendFileSync(
    process.env.LOOPIT_FAKE_INVOCATIONS,
    JSON.stringify({ args: process.argv.slice(2), prompt }) + "\\n",
  );
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
      LOOPIT_FAKE_INVOCATIONS: invocationPath,
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

  const invocations = (await readFile(invocationPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(invocations.length, 2);
  for (const invocation of invocations) {
    assert.ok(invocation.args.includes("--output-schema"));
    assert.equal(invocation.args.includes("resume"), false);
  }
  assert.match(invocations[1].prompt, /User: create a valid loop/);
  assert.match(invocations[1].prompt, /Codex: A valid loop is ready\./);

  const session = JSON.parse(
    await readFile(path.join(targetRoot, ".loopit", "session.json"), "utf8"),
  );
  assert.equal(
    Object.hasOwn(
      session.conversations[session.activeConversationId] ?? {},
      "codex",
    ),
    false,
  );
});

test("Claude construction starts fresh and receives durable conversation context", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "loopit-claude-"));
  const fakeBin = path.join(targetRoot, "fake-bin");
  const invocationPath = path.join(targetRoot, "claude-invocations.jsonl");
  await mkdir(fakeBin);
  const fakeClaude = path.join(fakeBin, "claude");
  await writeFile(
    fakeClaude,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("claude-test 1.0\\n");
  process.exit(0);
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  fs.appendFileSync(
    process.env.LOOPIT_FAKE_INVOCATIONS,
    JSON.stringify({ args: process.argv.slice(2), prompt }) + "\\n",
  );
  const count = fs.readFileSync(process.env.LOOPIT_FAKE_INVOCATIONS, "utf8").trim().split("\\n").length;
  process.stdout.write(JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "claude-session-" + count,
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: JSON.parse(process.env.FAKE_VALID_RESULT),
  }) + "\\n");
});
`,
    "utf8",
  );
  await chmod(fakeClaude, 0o755);

  const validResult = {
    action: "update",
    message: "Repository understanding confirmed and saved.",
    loop: { ...fixture, revision: 1 },
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
      LOOPIT_FAKE_INVOCATIONS: invocationPath,
      FAKE_VALID_RESULT: JSON.stringify(validResult),
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
  for (const message of [
    "Inspect this repository and propose its loop.",
    "Yes, that understanding is correct.",
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "claude", message }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Repository understanding confirmed/);
  }

  const invocations = (await readFile(invocationPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(invocations.length, 2);
  for (const invocation of invocations) {
    assert.ok(invocation.args.includes("--json-schema"));
    assert.equal(invocation.args.includes("--resume"), false);
  }
  assert.match(
    invocations[1].prompt,
    /User: Inspect this repository and propose its loop\./,
  );
  assert.match(
    invocations[1].prompt,
    /Claude: Repository understanding confirmed and saved\./,
  );

  const session = JSON.parse(
    await readFile(path.join(targetRoot, ".loopit", "session.json"), "utf8"),
  );
  assert.equal(
    Object.hasOwn(
      session.conversations[session.activeConversationId] ?? {},
      "claude",
    ),
    false,
  );
});
