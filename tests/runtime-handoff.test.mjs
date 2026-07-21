import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRuntimeHandoff,
  parseRuntimeIterations,
  serializeRuntimeIterations,
} from "../lib/runtime-handoff.mjs";

test("a worker handoff gives the scheduler its next iteration", () => {
  const handoff = parseRuntimeHandoff(`# Worker report

F1 passed its acceptance tests and the backlog was updated.

## Loopit iteration
Outcome: CONTINUE
State: plan_feature
Completed: F1 profile and resume intake
Next: F1.1 normalize migration columns
Reason: Objective-backed work remains in the feature backlog.`);

  assert.equal(handoff.outcome, "continue");
  assert.equal(handoff.state, "plan_feature");
  assert.equal(handoff.completed, "F1 profile and resume intake");
  assert.equal(handoff.next, "F1.1 normalize migration columns");
  assert.equal(handoff.declared, true);
});

test("a successful report without a boundary continues safely", () => {
  const handoff = parseRuntimeHandoff(
    "The feature result is durable and more backlog work remains.",
  );

  assert.equal(handoff.outcome, "continue");
  assert.equal(handoff.declared, false);
  assert.match(handoff.reason, /No runtime boundary was declared/);
});

test("completed iterations round-trip through readable Markdown", () => {
  const iterations = [
    {
      number: 1,
      outcome: "continue",
      state: "plan_feature",
      completed: "F1 profile intake",
      next: "F2 permitted job ingestion",
      reason: "The backlog still contains objective-backed features.",
      startedAt: "2026-07-21T03:27:41.947Z",
      finishedAt: "2026-07-21T03:33:45.698Z",
    },
    {
      number: 2,
      outcome: "pause",
      state: "await_decision",
      completed: "F2 ingestion sandbox",
      next: "Approve access to the selected job source",
      reason: "Source permission belongs to the user.",
      startedAt: "2026-07-21T03:34:00.000Z",
      finishedAt: "2026-07-21T03:40:00.000Z",
    },
  ];
  const markdown = `# Loop run

## Completed iterations

${serializeRuntimeIterations(iterations)}

## Activity

_No activity recorded._

## Latest worker report

Paused for permission.`;

  assert.deepEqual(parseRuntimeIterations(markdown), iterations);
});
