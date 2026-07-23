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
const integrating = process.argv.includes("--output-schema");
const prompt = fs.readFileSync(0, "utf8");
const understanding = prompt.includes("interactive understanding agent");
let count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : "0");
if (!integrating && !understanding) {
  count += 1;
  fs.writeFileSync(countPath, String(count));
}
const applyingSteering = integrating && prompt.includes("Prioritize reliability");
const continuing = count === 1 || applyingSteering;
const completed = applyingSteering ? "Reliability steering applied" : continuing ? "Feature one" : "Feature two";
const nextAction = applyingSteering ? "Feature three reliability work" : continuing ? "Feature two" : "Approve the external action";
const report = understanding
  ? "Feature one and feature two are integrated. The next action needs human approval. Evidence: iteration-0002."
  : integrating
  ? JSON.stringify({
      message: applyingSteering ? "Reliability steering is integrated and new work is ready." : continuing ? "Feature one is integrated; feature two is ready." : "Feature two is integrated and external approval is required.",
      outcome: continuing ? "continue" : "pause",
      progress: "advanced",
      completed,
      nextState: continuing ? "observe-work" : "await-decision",
      nextAction,
      reason: continuing ? "Objective-backed work remains." : "The next action requires human permission.",
      direction: {
        northStar: "Keep a verified view of the current operating environment.",
        currentDirection: "Advance the next verified feature.",
        currentObjective: continuing ? nextAction : "Await external approval.",
        better: ["Verified useful behavior"],
        hardRequirements: ["Do not invent evidence"],
        flexibleRequirements: ["Implementation may change with evidence"]
      },
      items: [{
        id: "working-feature",
        kind: "artifact",
        name: completed,
        status: "verified",
        summary: "The bounded feature passed its tests.",
        evidence: [".loopit/runtime/reports/iteration-" + String(count).padStart(4, "0") + ".md"]
      }],
      frontier: continuing ? [{
        id: applyingSteering ? "feature-three-reliability" : "feature-two",
        title: nextAction,
        status: "ready",
        priority: 100,
        objectiveLink: "Keep a verified view of the current operating environment.",
        causedBy: applyingSteering ? "Human steering prioritized reliability." : "Feature one exposed the next objective-backed gap.",
        retirementEvidence: applyingSteering ? "Reliability checks pass." : "Feature two passes its tests."
      }] : [{
        id: "external-approval",
        title: "Approve the external action",
        status: "waiting",
        priority: 100,
        objectiveLink: "Keep a verified view of the current operating environment.",
        causedBy: "The next action crosses an authority boundary.",
        retirementEvidence: "A human records explicit approval."
      }],
      decisions: continuing ? [] : [{
        id: "approve-action",
        question: "Approve the external action?",
        status: "waiting",
        context: "The next action crosses an authority boundary.",
        recommendation: "Review the evidence before approving."
      }],
      stateChanges: ["Recorded verified feature evidence."],
      frontierChanges: [applyingSteering ? "Added feature three reliability work." : continuing ? "Added feature two." : "Moved external approval to waiting."],
      relaxations: []
    })
  : [
      "# Iteration report",
      "## Summary",
      "Completed one bounded feature and collected evidence.",
      "## Assignment",
      "The leased feature.",
      "## Work performed",
      "Implemented the feature.",
      "## Deliverables",
      "Working code.",
      "## Evidence",
      "18 tests passed.",
      "## Outcome",
      "Status: completed",
      "## What appears to work",
      "The feature works.",
      "## Failures, limitations, and uncertainty",
      "None.",
      "## Candidate state updates",
      "Record the feature.",
      "## Suggested next work",
      continuing ? "Feature two." : "Request approval.",
      "## Provenance",
      "npm test."
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
    2,
    JSON.stringify(history.runs),
  );
  assert.equal(history.runs[0].iterations.length, 0);
  assert.equal(history.runs[1].iterations[0].completed, "Feature one");
  assert.equal(await readFile(countPath, "utf8"), "2");

  const runtimeResponse = await fetch(`${origin}/api/runtime`);
  const runtime = await runtimeResponse.json();
  assert.equal(runtime.state.version, 5);
  assert.equal(runtime.state.status, "paused");
  assert.equal(runtime.state.activeAssignment, null);
  assert.equal(runtime.ledger.length, 2);
  assert.equal(runtime.ledger[0].completed, "Feature one");
  assert.equal(runtime.ledger[1].completed, "Feature two");
  assert.equal(runtime.state.frontier[0].status, "waiting");

  const stateMarkdown = await readFile(
    path.join(loopitDir, "runtime", "STATE.md"),
    "utf8",
  );
  const ledgerMarkdown = await readFile(
    path.join(loopitDir, "runtime", "LEDGER.md"),
    "utf8",
  );
  const firstReport = await readFile(
    path.join(loopitDir, "runtime", "reports", "iteration-0001.md"),
    "utf8",
  );
  assert.match(stateMarkdown, /# Runtime state/);
  assert.match(stateMarkdown, /## Frontier/);
  assert.match(ledgerMarkdown, /## Iteration 1 —/);
  assert.match(ledgerMarkdown, /## Iteration 2 —/);
  assert.match(firstReport, /# Iteration report/);

  const steeringResponse = await fetch(`${origin}/api/runtime/steer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directive: "Prioritize reliability before expanding the feature set.",
    }),
  });
  assert.equal(steeringResponse.status, 200);
  const steered = await steeringResponse.json();
  assert.equal(steered.steering.at(-1).status, "pending");

  const steeredRunResponse = await fetch(`${origin}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex" }),
  });
  assert.equal(steeredRunResponse.status, 200);
  const steeredEvents = await steeredRunResponse.text();
  assert.equal(
    steeredEvents.match(/"type":"iteration_completed"/g)?.length,
    2,
  );

  const finalRuntimeResponse = await fetch(`${origin}/api/runtime`);
  const finalRuntime = await finalRuntimeResponse.json();
  assert.equal(finalRuntime.ledger.length, 4);
  assert.equal(finalRuntime.ledger[2].completed, "Reliability steering applied");
  assert.equal(finalRuntime.steering.at(-1).status, "applied");
  assert.equal(finalRuntime.steering.at(-1).appliedStateVersion, 7);
  assert.equal(await readFile(countPath, "utf8"), "3");

  const understandingResponse = await fetch(
    `${origin}/api/runtime/understand`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "codex",
        question: "What changed and what happens next?",
      }),
    },
  );
  assert.equal(understandingResponse.status, 200);
  const understandingEvents = await understandingResponse.text();
  assert.match(understandingEvents, /"type":"answer"/);
  assert.match(understandingEvents, /Feature one and feature two are integrated/);
  assert.equal(await readFile(countPath, "utf8"), "3");
});
