import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const daemon = await readFile(
  new URL("../scripts/loopit-daemon.mjs", import.meta.url),
  "utf8",
);

test("construction separates building a product from operating it", () => {
  assert.match(daemon, /The product, system, organization, or outcome being described/);
  assert.match(daemon, /The work that this loop itself should repeatedly advance/);
  assert.match(daemon, /default to a development loop/);
  assert.match(daemon, /future product behavior becomes capability requirements/);
  assert.match(daemon, /whether the loop should build and improve the system or operate it/);
});

test("fresh-agent rehearsal rejects a loop built at the wrong layer", () => {
  assert.match(daemon, /Fail a loop that chose the wrong layer/);
  assert.match(daemon, /operational job searching when the user's stated intent is to build/);
  assert.match(daemon, /do not mix development with operation/);
});

test("construction requires objective-grounded frontier replenishment", () => {
  assert.match(daemon, /Define a frontier replenishment contract/);
  assert.match(daemon, /Every newly created frontier item must cite the objective criterion/);
  assert.match(daemon, /Never replenish the frontier with unrelated ideas/);
  assert.match(daemon, /Define the empty-frontier protocol/);
  assert.match(daemon, /a back edge without a replenishment source is not a continuing loop/);
});

test("rehearsal exhausts the frontier and rejects ungrounded continuation", () => {
  assert.match(daemon, /Trace every newly created frontier item back to both an objective criterion and causal evidence/);
  assert.match(daemon, /Exhaust the current frontier in rehearsal/);
  assert.match(daemon, /stops merely because its initial list is empty/);
});

test("construction proposes a generalized domain-specific starting package", () => {
  assert.match(daemon, /Propose a Starting Package before declaring the loop ready/);
  assert.match(daemon, /Use established professional vocabulary, not newly coined Loopit vocabulary/);
  assert.match(daemon, /Backlog -> Plan feature -> Implement -> Test -> Review or merge -> Update backlog/);
  assert.match(daemon, /Hypothesis -> Method or experiment plan -> Experiment -> Data -> Analysis/);
  assert.match(daemon, /Do not invent compound phrases such as Frame capability slice/);
  assert.match(daemon, /practitioner can understand the overview without a Loopit glossary/);
  assert.match(daemon, /Role values are internal Markdown structure, not user-facing vocabulary/);
  assert.match(daemon, /state: the evidence-backed model/);
  assert.match(daemon, /frontier: initial objective-backed/);
  assert.match(daemon, /foundation: the minimal apparatus, tools, data, access, authority/);
  assert.match(daemon, /first-work: one bounded, executable item/);
  assert.match(daemon, /Do not assume software, cloud, or code/);
});

test("construction keeps artifacts and runtime boundaries in separate sections", () => {
  assert.match(daemon, /One H2 Artifacts section/);
  assert.match(daemon, /One separate H2 Boundaries section/);
  assert.match(daemon, /Never combine Artifacts and Boundaries under one heading/);
});

test("rehearsal verifies that the starting package can actually begin", () => {
  assert.match(daemon, /Inspect the Starting Package before tracing the cycle/);
  assert.match(daemon, /the H3 names must use terms familiar to a practitioner in that field/);
  assert.match(daemon, /Fail both generic engine language and newly invented compound jargon/);
  assert.match(daemon, /reject names such as Frame capability slice/);
  assert.match(daemon, /first work is drawn from the frontier/);
  assert.match(daemon, /pushing raw methodology, tool, infrastructure, or architecture selection onto a nonexpert/);
});
