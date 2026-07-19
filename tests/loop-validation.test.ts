import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { LoopDefinition } from "../lib/loop-types";
import {
  parseLoopMarkdown,
  serializeLoopMarkdown,
} from "../lib/loop-markdown.mjs";
import { primarySequence } from "../lib/loop-flow.ts";
import { validateLoop } from "../lib/loop-validation.ts";

const loopSource = await readFile(
  new URL("./fixtures/example-loop.md", import.meta.url),
  "utf8",
);
const loop = parseLoopMarkdown(loopSource) as LoopDefinition;

test("the seed loop has a reachable, state-updating continuation cycle", () => {
  const findings = validateLoop(loop);

  assert.ok(findings.some((finding) => finding.id === "cycle-found"));
  assert.ok(findings.some((finding) => finding.id === "structurally-viable"));
  assert.equal(
    findings.filter((finding) => finding.severity === "error").length,
    0,
  );
});

test("the Markdown parser rejects invalid machine-critical fields", () => {
  const malformed = loopSource.replace(
    "`normal` | `observe-to-evaluate`",
    "`sideways` | `observe-to-evaluate`",
  );
  assert.throws(() => parseLoopMarkdown(malformed), /must be one of/);
});

test("visual edits round-trip through Markdown without losing the loop", () => {
  const roundTripped = parseLoopMarkdown(serializeLoopMarkdown(loop));
  assert.deepEqual(roundTripped, loop);
});

test("Markdown is the only durable loop definition", async () => {
  assert.equal(loop.schemaVersion, 1);
  assert.equal(loop.states.length, 5);
  await assert.rejects(
    readFile(new URL("../.loopit/loop.json", import.meta.url), "utf8"),
    { code: "ENOENT" },
  );
});

test("validation identifies a nonterminal dead end", () => {
  const broken = structuredClone(loop);
  const revision = broken.states.find((state) => state.id === "update-state");
  assert.ok(revision);
  revision.transitions = [];

  const findings = validateLoop(broken);
  assert.ok(findings.some((finding) => finding.id === "dead-end-update-state"));
  assert.ok(findings.some((finding) => finding.id === "missing-cycle"));
});

test("the displayed state flow follows a reachable cycle and keeps branches aside", () => {
  const sequence = primarySequence(loop);
  const sideTransitions = loop.states.flatMap((state) =>
    state.transitions.filter(
      (transition) => !sequence.chosenTransitionIds.has(transition.id),
    ),
  );
  const transitionCount = loop.states.reduce(
    (total, state) => total + state.transitions.length,
    0,
  );

  assert.deepEqual(
    sequence.states.map((state) => state.id),
    ["observe-work", "evaluate-work", "update-state"],
  );
  assert.equal(sequence.loopBack?.targetId, "evaluate-work");
  assert.equal(sequence.loopBack?.targetIndex, 1);
  assert.equal(sequence.chosenTransitionIds.has("observe-to-human"), false);
  assert.equal(sequence.chosenTransitionIds.has("evaluate-to-complete"), false);
  assert.equal(sequence.chosenTransitionIds.size + sideTransitions.length, transitionCount);
});

test("the displayed state flow backtracks past a dead end to find the loop", () => {
  const branching = structuredClone(loop);
  const observe = branching.states.find((state) => state.id === "observe-work");
  assert.ok(observe);
  observe.transitions = [
    {
      id: "observe-to-complete-first",
      to: "loop-complete",
      when: "A tempting first path stops",
      kind: "normal",
    },
    ...observe.transitions,
  ];

  const sequence = primarySequence(branching);
  assert.equal(sequence.loopBack?.targetId, "evaluate-work");
  assert.equal(
    sequence.chosenTransitionIds.has("observe-to-complete-first"),
    false,
  );
});
