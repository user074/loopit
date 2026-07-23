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

async function waitForHealth(origin, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Loopit daemon exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // The daemon may still be binding its localhost port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Loopit daemon did not become healthy.");
}

test("runtime automatically starts the next loop iteration", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "loopit-runtime-"));
  const fakeBin = await mkdtemp(path.join(os.tmpdir(), "loopit-bin-"));
  const countPath = path.join(targetRoot, "worker-count.txt");
  const fakeCodexPath = path.join(fakeBin, "codex");
  await writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-test 1.0\\n");
  process.exit(0);
}
const countPath = process.env.LOOPIT_FAKE_COUNT;
const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : "0") + 1;
fs.writeFileSync(countPath, String(count));
const continuing = count === 1;
const report = [
  "Completed one bounded feature and integrated its evidence.",
  "",
  "## Loopit iteration",
  "Outcome: " + (continuing ? "CONTINUE" : "PAUSE"),
  "State: " + (continuing ? "observe-work" : "await-decision"),
  "Completed: " + (continuing ? "Feature one" : "Feature two"),
  "Next: " + (continuing ? "Feature two" : "Approve the external action"),
  "Reason: " + (continuing ? "Objective-backed work remains." : "The next action requires human permission."),
].join("\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "fake-" + count }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
process.stdout.write(JSON.stringify({
  type: "item.started",
  item: { type: "command_execution", command: "npm test" },
}) + "\\n");
process.stdout.write(JSON.stringify({
  type: "item.completed",
  item: {
    type: "command_execution",
    command: "npm test",
    aggregated_output: "18 tests passed",
    exit_code: 0,
  },
}) + "\\n");
process.stdout.write(JSON.stringify({
  type: "item.completed",
  item: { type: "web_search", query: "official project documentation" },
}) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: report } }) + "\\n");
process.stdout.write(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: 120, output_tokens: 40 },
}) + "\\n");
`,
    "utf8",
  );
  await chmod(fakeCodexPath, 0o755);

  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [daemonPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      LOOPIT_APP_ROOT: repositoryRoot,
      LOOPIT_PROJECT: targetRoot,
      LOOPIT_DAEMON_PORT: String(port),
      LOOPIT_FAKE_COUNT: countPath,
    },
    stdio: "ignore",
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await Promise.all([
      rm(targetRoot, { recursive: true, force: true }),
      rm(fakeBin, { recursive: true, force: true }),
    ]);
  });

  await waitForHealth(origin, child);
  const loopitDir = path.join(targetRoot, ".loopit");
  await mkdir(loopitDir, { recursive: true });
  await writeFile(
    path.join(loopitDir, "loop.md"),
    await readFile(
      path.join(repositoryRoot, "tests", "fixtures", "example-loop.md"),
      "utf8",
    ),
    "utf8",
  );
  await writeFile(
    path.join(loopitDir, "test-report.md"),
    `---
loopit-test: 1
verdict: pass
agent: codex
loop-revision: 1
tested-at: 2026-07-21T00:00:00.000Z
---

Verdict: PASS
`,
    "utf8",
  );

  const response = await fetch(`${origin}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex" }),
  });
  assert.equal(response.status, 200);
  const events = await response.text();
  assert.equal(events.match(/"type":"iteration_completed"/g)?.length, 2);
  assert.match(events, /"text":"Running project command"/);
  assert.match(events, /"text":"Project command finished"/);
  assert.match(events, /"output":"18 tests passed"/);
  assert.match(events, /"text":"Web search finished"/);
  assert.match(events, /"text":"Agent turn finished"/);

  const latestResponse = await fetch(`${origin}/api/run`);
  const { run, runs } = await latestResponse.json();
  assert.equal(run.active, false);
  assert.equal(run.status, "paused");
  assert.equal(run.iterations.length, 2);
  assert.equal(run.iterations[0].completed, "Feature one");
  assert.equal(run.iterations[0].next, "Feature two");
  assert.equal(run.iterations[1].completed, "Feature two");
  assert.equal(run.iterations[1].outcome, "pause");
  assert.equal(runs.length, 1);
  assert.equal(await readFile(countPath, "utf8"), "2");

  const runMarkdown = await readFile(
    path.join(loopitDir, "runs", `${run.id}.md`),
    "utf8",
  );
  assert.match(runMarkdown, /## Completed iterations/);
  assert.match(runMarkdown, /### Iteration 1/);
  assert.match(runMarkdown, /### Iteration 2/);

  const restartedResponse = await fetch(`${origin}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex" }),
  });
  assert.equal(restartedResponse.status, 200);
  await restartedResponse.text();

  const historyResponse = await fetch(`${origin}/api/run`);
  const history = await historyResponse.json();
  assert.equal(history.runs.length, 2);
  assert.equal(
    history.runs.reduce(
      (total, item) => total + item.iterations.length,
      0,
    ),
    3,
  );
  assert.equal(history.runs[0].iterations[0].completed, "Feature two");
  assert.equal(history.runs[1].iterations[0].completed, "Feature one");
});
