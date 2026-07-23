import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createInitialRuntimeState,
  integrationState,
  parseRuntimeStateMarkdown,
  selectRuntimeAssignment,
  serializeRuntimeAssignment,
  serializeRuntimeState,
} from "../lib/runtime-state.mjs";
import {
  parseRuntimeLedger,
  serializeRuntimeLedger,
} from "../lib/runtime-ledger.mjs";
import { parseLoopMarkdown } from "../lib/loop-markdown.mjs";

const fixturePath = fileURLToPath(
  new URL("./fixtures/example-loop.md", import.meta.url),
);
const runtimeSchemaPath = fileURLToPath(
  new URL("../schemas/runtime-integration-output.schema.json", import.meta.url),
);

test("runtime integration schema constrains machine-owned state fields", async () => {
  const schema = JSON.parse(await readFile(runtimeSchemaPath, "utf8"));
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.outcome.enum, [
    "continue",
    "pause",
    "complete",
  ]);
  assert.deepEqual(
    schema.properties.items.items.properties.kind.enum,
    ["artifact", "belief", "failure", "uncertainty"],
  );
  assert.deepEqual(
    schema.properties.frontier.items.properties.status.enum,
    ["ready", "waiting", "retired"],
  );
  assert.ok(schema.required.includes("direction"));
  assert.ok(schema.required.includes("frontier"));
  assert.ok(schema.required.includes("stateChanges"));
});

test("runtime state initializes from the loop and round-trips through Markdown", async () => {
  const loop = parseLoopMarkdown(await readFile(fixturePath, "utf8"));
  const initial = createInitialRuntimeState(loop, {
    mode: "unattended",
    runUntil: "2026-07-23T08:00:00.000Z",
    maxIterations: 12,
  });
  const markdown = serializeRuntimeState(initial);
  const parsed = parseRuntimeStateMarkdown(markdown);

  assert.equal(parsed.direction.northStar, loop.objective);
  assert.equal(parsed.autonomy.mode, "unattended");
  assert.equal(parsed.autonomy.maxIterations, 12);
  assert.ok(parsed.items.length >= 2);
  assert.ok(parsed.frontier.length >= 1);
  assert.equal(parsed.frontier[0].status, initial.frontier[0].status);
  assert.equal(parsed.frontier[0].priority, initial.frontier[0].priority);
  assert.equal(parsed.items[0].kind, initial.items[0].kind);
  assert.equal(parsed.items[0].status, initial.items[0].status);
  assert.deepEqual(parsed.items[0].evidence, initial.items[0].evidence);
  assert.match(markdown, /## What appears to work|## State items/);
  assert.doesNotMatch(markdown, /```json/);
});

test("the runtime leases one frontier item as an immutable assignment", async () => {
  const loop = parseLoopMarkdown(await readFile(fixturePath, "utf8"));
  const initial = createInitialRuntimeState(loop);
  const { state, assignment } = selectRuntimeAssignment(
    initial,
    loop,
    "iteration-0001",
    "2026-07-22T12:00:00.000Z",
  );

  assert.equal(assignment.frontierId, initial.frontier[0].id);
  assert.equal(state.activeAssignment.id, "iteration-0001");
  assert.equal(
    state.frontier.find((item) => item.id === assignment.frontierId)?.status,
    "active",
  );
  assert.match(
    serializeRuntimeAssignment(assignment, state.version),
    /Do not edit files under `\.loopit\/`/,
  );
});

test("integration replaces semantic state while preserving runtime policy", async () => {
  const loop = parseLoopMarkdown(await readFile(fixturePath, "utf8"));
  const initial = createInitialRuntimeState(loop, {
    mode: "unattended",
    maxIterations: 8,
  });
  const { state } = selectRuntimeAssignment(
    initial,
    loop,
    "iteration-0001",
    "2026-07-22T12:00:00.000Z",
  );
  const integrated = integrationState(
    state,
    {
      outcome: "continue",
      direction: {
        ...state.direction,
        currentObjective: "Verify the next observable result",
      },
      items: [
        ...state.items,
        {
          id: "result-001",
          kind: "belief",
          name: "The first result is reproducible",
          status: "supported",
          summary: "The worker reproduced the result twice.",
          evidence: ["iteration-0001"],
        },
      ],
      frontier: [
        {
          id: "frontier-002",
          title: "Test the next failure mode",
          status: "ready",
          priority: 90,
          objectiveLink: loop.objective,
          causedBy: "The first result exposed an untested failure mode.",
          retirementEvidence: "A report exercises and evaluates the failure mode.",
        },
      ],
      decisions: [],
    },
    "2026-07-22T12:30:00.000Z",
  );

  assert.equal(integrated.autonomy.mode, "unattended");
  assert.equal(integrated.autonomy.maxIterations, 8);
  assert.equal(integrated.activeAssignment, null);
  assert.equal(integrated.status, "ready");
  assert.equal(integrated.version, state.version + 1);
});

test("runtime ledger preserves the auditable state trajectory", () => {
  const entry = {
    number: 1,
    title: "Verify profile import",
    id: "iteration-0001",
    runId: "run-1-deadbeef",
    loopRevision: 1,
    assignmentId: "iteration-0001",
    outcome: "continue",
    progress: "advanced",
    startedAt: "2026-07-22T12:00:00.000Z",
    finishedAt: "2026-07-22T12:30:00.000Z",
    fromVersion: 2,
    toVersion: 3,
    reportPath: ".loopit/runtime/reports/iteration-0001.md",
    completed: "Profile import works for PDF and DOCX fixtures.",
    next: "Test malformed inputs.",
    reason: "A new objective-backed reliability gap remains.",
    stateChanges: ["Added supported import capability."],
    frontierChanges: ["Retired profile import; added malformed inputs."],
    relaxations: [],
  };
  const parsed = parseRuntimeLedger(serializeRuntimeLedger([entry]));
  assert.deepEqual(parsed[0], entry);
});
