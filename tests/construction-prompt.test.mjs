import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const daemon = await readFile(
  new URL("../scripts/loopit-daemon.mjs", import.meta.url),
  "utf8",
);
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("README presents the Codex and GPT-5.6 Sol conversation as the build process", () => {
  assert.match(readme, /Built entirely with OpenAI Codex \+ GPT-5\.6 Sol at Extra High reasoning/);
  assert.match(readme, /## The conversation is how Codex and GPT-5\.6 Sol were used/);
  assert.match(readme, /using \*\*GPT-5\.6 Sol\*\* with \*\*Extra High\*\* reasoning \(`xhigh`\) for every stage/);
  assert.match(readme, /Discovering the problem/);
  assert.match(readme, /Generalizing from lived examples/);
  assert.match(readme, /Designing the interface/);
  assert.match(readme, /Implementing and verifying it/);
  assert.match(readme, /Dogfooding the runtime/);
  assert.match(readme, /## Install and run — copy\/paste/);
  assert.match(readme, /git clone https:\/\/github\.com\/user074\/loopit\.git/);
  assert.match(readme, /npm link/);
  assert.match(readme, /Then open a terminal[\s\S]*```bash\nloopit\n```/);
  assert.match(readme, /Every Codex and Claude construction turn starts fresh/);
  assert.match(readme, /saved Markdown conversation plus the current `loop\.md`/);
  assert.doesNotMatch(readme, /LOOPIT_CODEX_MODEL=/);
});

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

test("runtime understanding includes live operational context", () => {
  assert.match(daemon, /Live operational context \(in-memory and not yet durable\)/);
  assert.match(daemon, /Recent operational events/);
  assert.match(daemon, /use the live operational context above/);
  assert.match(daemon, /Observer is still reading/);
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
  assert.match(daemon, /Context: the exact state, artifact, evidence gap, and consequence/);
  assert.match(daemon, /Question: one focused question the user can answer now/);
  assert.match(daemon, /Recommendation: the safest useful default/);
  assert.match(daemon, /Why human: the intent, authority, private fact, cost, or risk judgment/);
  assert.match(daemon, /Do not hide a required human decision/);
  assert.match(daemon, /open a human review with a recommended next step/);
  assert.match(daemon, /Parser errors, schema fields, IDs, Kind values/);
});

test("construction uses a machine-constrained loop handoff", () => {
  assert.match(daemon, /Return only the structured response required by the supplied output schema/);
  assert.match(daemon, /Loopit validates that response and serializes the loop into canonical Markdown/);
  assert.match(daemon, /"--json-schema"/);
  assert.equal(daemon.match(/"--output-schema"/g)?.length, 2);
  assert.match(daemon, /constructionSchemaPath/);
  assert.match(daemon, /runtimeIntegrationSchemaPath/);
  assert.match(daemon, /applyConstructionResult/);
  assert.match(daemon, /"--sandbox",\s*"read-only"/);
});

test("first launch discovers the repository before creating a loop", () => {
  assert.match(daemon, /Inspect the repository before asking the user to describe it from scratch/);
  assert.match(daemon, /state your understanding of what the repository is building or doing/);
  assert.match(daemon, /ask the user to confirm or correct that understanding/i);
  assert.match(daemon, /Do not generate the first loop before the user has confirmed/);
});

test("Codex and Claude construction use durable Loopit history instead of resume", () => {
  const claudeBranch = daemon.match(
    /if \(agent === "claude"\) \{([\s\S]*?)return \{ command: "claude", args, input: prompt \};/,
  )?.[1] ?? "";
  assert.match(claudeBranch, /"--json-schema"/);
  assert.doesNotMatch(claudeBranch, /"--resume"/);
  assert.doesNotMatch(daemon, /"resume"/);
  assert.match(daemon, /constructionConversationContext/);
  assert.match(daemon, /Saved Loopit conversation context/);
});

test("construction testing has a reachable passed outcome", () => {
  assert.match(daemon, /PASS completes "Test this loop" for the current revision/);
  assert.match(daemon, /Missing runtime evidence alone is not a RISK/);
  assert.match(daemon, /Runtime proof by itself does not lower PASS to RISK/);
  assert.match(daemon, /missing proof path/);
});

test("runtime is gated by the current passed revision and uses a separate worker", () => {
  assert.match(daemon, /Pass Test this loop for revision/);
  assert.match(daemon, /You are a bounded worker for Loopit run/);
  assert.match(daemon, /Loopit—not this worker—owns integration/);
  assert.match(daemon, /Do not edit any file under \.loopit\//);
  assert.match(daemon, /Execute only that assignment/);
  assert.match(daemon, /LOOPIT_PHASE:/);
  assert.match(daemon, /type: "presence"/);
  assert.match(daemon, /phaseCheckIn/);
  assert.match(daemon, /# Iteration report/);
  assert.match(daemon, /You are the Loopit runtime supervisor integrating one bounded worker result/);
  assert.match(daemon, /Return the full next direction, full state item list, full frontier/);
  assert.match(daemon, /validateRuntimeIntegration/);
  assert.match(daemon, /integrationState/);
  assert.match(daemon, /Loop iteration \$\{iterationNumber\} completed/);
  assert.match(daemon, /handoff\.outcome === "continue"/);
  assert.match(daemon, /runtime\/STATE\.md/);
  assert.match(daemon, /runtime\/LEDGER\.md/);
  assert.match(daemon, /runtimeReviewPath/);
  assert.match(daemon, /url\.pathname === "\/api\/run"/);
  assert.match(daemon, /mkdir\(runsDir/);
  assert.match(daemon, /activeRun\?\.purpose === "runtime"/);
  assert.match(daemon, /status: run\.status === "running" && !active/);
  assert.match(daemon, /publishActivity/);
  assert.match(daemon, /function claudeActivities/);
  assert.match(daemon, /Claude is retrying a provider request/);
  assert.match(daemon, /aggregated_output/);
  assert.match(daemon, /Agent reported progress/);
  assert.match(daemon, /Agent is still working/);
  assert.match(daemon, /Deliberately do not expose thinking blocks/);
  assert.match(daemon, /## Activity/);
});

test("Codex accepts explicitly selected projects before Git initialization", () => {
  assert.equal(
    daemon.match(/"--skip-git-repo-check"/g)?.length,
    5,
    "construction, rehearsal, worker, supervisor, and understanding turns must accept a new project directory",
  );
  assert.match(daemon, /"--sandbox",\s*"workspace-write"/);
  assert.match(daemon, /"--sandbox",\s*"read-only"/);
});
