import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { LoopDefinition } from "../lib/loop-types";
import { parseLoopMarkdown } from "../lib/loop-markdown.mjs";
import { validateLoop } from "../lib/loop-validation.ts";

const loopSource = await readFile(
  new URL("../.loopit/loop.md", import.meta.url),
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
    "`normal` | `goal-to-state`",
    "`sideways` | `goal-to-state`",
  );
  assert.throws(() => parseLoopMarkdown(malformed), /must be one of/);
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
  const revision = broken.states.find((state) => state.id === "revise-loop");
  assert.ok(revision);
  revision.transitions = [];

  const findings = validateLoop(broken);
  assert.ok(findings.some((finding) => finding.id === "dead-end-revise-loop"));
  assert.ok(findings.some((finding) => finding.id === "missing-cycle"));
});
