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
  assert.match(daemon, /Separate the user's starting work from setup/);
  assert.match(daemon, /concrete objects the user cares about, not broad directions or setup chores/);
  assert.match(daemon, /specific hypotheses or claims with supported, contradicted, or uncertain status/);
  assert.match(daemon, /specific user-visible features with implemented, partial, failing, or not-started status/);
  assert.match(daemon, /several specific initial items ready to pursue, not umbrella categories/);
  assert.match(daemon, /Complete both Starting work and Setup in the same construction turn/);
  assert.match(daemon, /Keep Initial Contents scannable in the web tables/);
  assert.match(daemon, /Use established professional vocabulary, not newly coined Loopit vocabulary/);
  assert.match(daemon, /Backlog -> Plan feature -> Implement -> Test -> Review or merge -> Update backlog/);
  assert.match(daemon, /Hypothesis -> Method or experiment plan -> Experiment -> Data -> Analysis/);
  assert.match(daemon, /Do not invent compound phrases such as Frame capability slice/);
  assert.match(daemon, /practitioner can understand the overview without a Loopit glossary/);
  assert.match(daemon, /Role values are internal Markdown structure, not user-facing vocabulary/);
  assert.match(daemon, /For research, specify the data or sample, method, baseline, evaluation metric/);
  assert.match(daemon, /exact initial model family and size or a precise selection rule/);
  assert.match(daemon, /For software, specify the existing or proposed stack/);
  assert.match(daemon, /For UI\/UX, specify the design tool/);
});

test("construction keeps artifacts and runtime boundaries in separate sections", () => {
  assert.match(daemon, /One H2 Artifacts section/);
  assert.match(daemon, /One separate H2 Boundaries section/);
  assert.match(daemon, /Never combine Artifacts and Boundaries under one heading/);
});

test("rehearsal verifies that the starting package can actually begin", () => {
  assert.match(daemon, /Inspect Starting work before tracing the cycle/);
  assert.match(daemon, /specific hypotheses and their initial evidence status, features and implementation status/);
  assert.match(daemon, /Inspect Setup separately/);
  assert.match(daemon, /require the relevant data or sample, method, baseline, evaluation metric/);
  assert.match(daemon, /Fail both generic engine language and newly invented compound jargon/);
  assert.match(daemon, /reject names such as Frame capability slice/);
  assert.match(daemon, /Fail a loop that would require another user prompt merely to obtain its initial hypotheses/);
  assert.match(daemon, /pushing raw methodology, tool, infrastructure, or architecture selection onto a nonexpert/);
});

test("rehearsal turns human-owned gaps into a decision panel contract", () => {
  assert.match(daemon, /make that subsection directly renderable as a decision panel/);
  assert.match(daemon, /Question: one focused question the user can answer now/);
  assert.match(daemon, /Recommendation: the safest useful default/);
  assert.match(daemon, /Why human: the intent, authority, private fact, cost, or risk judgment/);
  assert.match(daemon, /Do not hide a required human decision/);
  assert.match(daemon, /open a human review with a recommended next step/);
});

test("construction testing has a reachable passed outcome", () => {
  assert.match(daemon, /PASS completes "Test this loop" for the current revision/);
  assert.match(daemon, /Missing runtime evidence alone is not a RISK/);
  assert.match(daemon, /Runtime proof by itself does not lower PASS to RISK/);
  assert.match(daemon, /missing proof path/);
});

test("runtime is gated by the current passed revision and uses a separate worker", () => {
  assert.match(daemon, /Pass Test this loop for revision/);
  assert.match(daemon, /You are the worker for Loopit run/);
  assert.match(daemon, /do not redesign it and do not edit \.loopit\/loop\.md/);
  assert.match(daemon, /Begin from the declared first work and start state/);
  assert.match(daemon, /url\.pathname === "\/api\/run"/);
  assert.match(daemon, /mkdir\(runsDir/);
  assert.match(daemon, /activeRun\?\.purpose === "runtime"/);
  assert.match(daemon, /status: run\.status === "running" && !active/);
});
