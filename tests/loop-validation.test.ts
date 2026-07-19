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

  const malformedPolicy = loopSource.replace(
    "completion-policy: confirm",
    "completion-policy: hopeful",
  );
  assert.throws(() => parseLoopMarkdown(malformedPolicy), /must be one of/);
});

test("legacy Markdown defaults to human-confirmed completion", () => {
  const legacy = loopSource.replace("completion-policy: confirm\n", "");
  assert.equal(parseLoopMarkdown(legacy).completionPolicy, "confirm");
});

test("visual edits round-trip through Markdown without losing the loop", () => {
  const roundTripped = parseLoopMarkdown(serializeLoopMarkdown(loop));
  assert.deepEqual(roundTripped, loop);
});

test("Markdown is the only durable loop definition", async () => {
  assert.equal(loop.schemaVersion, 1);
  assert.equal(loop.states.length, 7);
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
  assert.equal(sequence.chosenTransitionIds.has("evaluate-to-challenge"), false);
  assert.equal(sequence.chosenTransitionIds.size + sideTransitions.length, transitionCount);
});

test("human-confirmed completion requires a challenger with both outcomes", () => {
  const missingChallenge = structuredClone(loop);
  missingChallenge.states = missingChallenge.states.filter(
    (state) => state.id !== "challenge-completion",
  );
  const evaluate = missingChallenge.states.find(
    (state) => state.id === "evaluate-work",
  );
  assert.ok(evaluate);
  evaluate.transitions = evaluate.transitions.filter(
    (transition) => transition.to !== "challenge-completion",
  );

  const findings = validateLoop(missingChallenge);
  assert.ok(
    findings.some((finding) => finding.id === "missing-completion-challenge"),
  );

  const noReopen = structuredClone(loop);
  const challenge = noReopen.states.find(
    (state) => state.id === "challenge-completion",
  );
  assert.ok(challenge);
  challenge.transitions = challenge.transitions.filter(
    (transition) => transition.id !== "challenge-to-update",
  );
  assert.ok(
    validateLoop(noReopen).some(
      (finding) =>
        finding.id === "challenge-cannot-continue-challenge-completion",
    ),
  );
});

test("human-confirmed completion rejects an unchallenged shortcut", () => {
  const bypass = structuredClone(loop);
  const evaluate = bypass.states.find((state) => state.id === "evaluate-work");
  assert.ok(evaluate);
  evaluate.transitions.push({
    id: "evaluate-directly-to-complete",
    to: "loop-complete",
    when: "The current evidence appears sufficient",
    kind: "complete",
  });

  assert.ok(
    validateLoop(bypass).some(
      (finding) => finding.id === "completion-bypasses-challenge",
    ),
  );
});

test("automatic completion cannot depend on a human interrupt", () => {
  const automatic = structuredClone(loop);
  automatic.completionPolicy = "automatic";

  assert.ok(
    validateLoop(automatic).some(
      (finding) =>
        finding.id ===
        "challenge-missing-auto-acceptance-challenge-completion",
    ),
  );
});

test("continuous exploration does not require a project completion exit", () => {
  const continuous = structuredClone(loop);
  continuous.completionPolicy = "continuous";
  continuous.states = continuous.states.filter(
    (state) =>
      state.id !== "challenge-completion" &&
      state.id !== "confirm-completion" &&
      state.id !== "loop-complete",
  );
  const evaluate = continuous.states.find(
    (state) => state.id === "evaluate-work",
  );
  assert.ok(evaluate);
  evaluate.transitions = evaluate.transitions.filter(
    (transition) => transition.id !== "evaluate-to-challenge",
  );

  const findings = validateLoop(continuous);
  assert.equal(
    findings.filter((finding) => finding.severity === "error").length,
    0,
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.id === "missing-completion" && finding.severity === "pass",
    ),
  );
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

test("the displayed state flow prefers evidence-producing work over a shorter recovery cycle", () => {
  const branching = structuredClone(loop);
  const observe = branching.states.find((state) => state.id === "observe-work");
  assert.ok(observe);
  observe.transitions = [
    {
      id: "observe-to-recovery-first",
      to: "recover-work",
      when: "The ordinary read fails",
      kind: "normal",
    },
    ...observe.transitions,
  ];
  branching.states.push({
    id: "recover-work",
    name: "Recover work",
    kind: "update",
    summary: "Record and retry a bounded failure.",
    reads: ["Failure evidence"],
    instruction: "Record the failure and select a bounded retry.",
    writes: ["Current state"],
    completion: "A retry is recorded.",
    transitions: [
      {
        id: "recovery-to-observe",
        to: "observe-work",
        when: "A retry is available",
        kind: "continue",
      },
    ],
  });

  const sequence = primarySequence(branching);
  assert.deepEqual(
    sequence.states.map((state) => state.id),
    ["observe-work", "evaluate-work", "update-state"],
  );
  assert.equal(
    sequence.chosenTransitionIds.has("observe-to-recovery-first"),
    false,
  );
});
