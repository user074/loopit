import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import {
  appendConversationMarkdown,
  emptyConversationMarkdown,
  parseConversationMarkdown,
  summarizeConversationMarkdown,
} from "../lib/conversation-markdown.mjs";
import {
  parseLoopMarkdown,
  serializeLoopMarkdown,
} from "../lib/loop-markdown.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.env.LOOPIT_PROJECT || process.cwd());
const loopitDir = path.join(projectRoot, ".loopit");
const loopPath = path.join(loopitDir, "loop.md");
const sessionPath = path.join(loopitDir, "session.json");
const legacyConversationPath = path.join(loopitDir, "conversation.md");
const conversationsDir = path.join(loopitDir, "conversations");
const runsDir = path.join(loopitDir, "runs");
const testReportPath = path.join(loopitDir, "test-report.md");
const testOutputPath = path.join(loopitDir, ".test-agent-output.tmp");
const port = Number(process.env.LOOPIT_DAEMON_PORT || 4318);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

let activeRun = null;
let conversationWriteQueue = Promise.resolve();

await Promise.all([
  mkdir(loopitDir, { recursive: true }),
  mkdir(conversationsDir, { recursive: true }),
  mkdir(runsDir, { recursive: true }),
]);

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function writeText(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, file);
}

async function readLoopOrNull() {
  try {
    return parseLoopMarkdown(await readFile(loopPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function newConversationId() {
  return `conversation-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function isConversationId(value) {
  return /^conversation-\d+-[a-f0-9-]+$/.test(String(value ?? ""));
}

function conversationPath(id) {
  if (!isConversationId(id)) throw new Error("Invalid conversation identifier.");
  return path.join(conversationsDir, `${id}.md`);
}

async function readConversationStore() {
  const stored = await readJson(sessionPath, {});
  if (
    stored?.version === 2 &&
    isConversationId(stored.activeConversationId) &&
    stored.conversations &&
    typeof stored.conversations === "object"
  ) {
    try {
      await readFile(conversationPath(stored.activeConversationId), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeText(
        conversationPath(stored.activeConversationId),
        emptyConversationMarkdown(),
      );
    }
    return stored;
  }

  const existingFiles = (await readdir(conversationsDir))
    .filter((name) => /^conversation-\d+-[a-f0-9-]+\.md$/.test(name))
    .sort();
  const activeConversationId = existingFiles.length
    ? existingFiles.at(-1).slice(0, -3)
    : newConversationId();

  if (!existingFiles.length) {
    let legacySource = emptyConversationMarkdown();
    try {
      legacySource = await readFile(legacyConversationPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await writeText(conversationPath(activeConversationId), legacySource);
    await unlink(legacyConversationPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  const legacySessions = {};
  for (const agent of ["codex", "claude"]) {
    if (stored?.[agent]?.sessionId) legacySessions[agent] = stored[agent];
  }
  const migrated = {
    version: 2,
    activeConversationId,
    conversations: { [activeConversationId]: legacySessions },
  };
  await writeJson(sessionPath, migrated);
  return migrated;
}

async function readConversationSource(id) {
  try {
    return await readFile(conversationPath(id), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyConversationMarkdown();
    throw error;
  }
}

async function listConversations(activeConversationId) {
  const files = (await readdir(conversationsDir)).filter((name) =>
    /^conversation-\d+-[a-f0-9-]+\.md$/.test(name),
  );
  const conversations = await Promise.all(
    files.map(async (name) => {
      const id = name.slice(0, -3);
      const summary = summarizeConversationMarkdown(
        await readConversationSource(id),
        id,
      );
      return { ...summary, active: id === activeConversationId };
    }),
  );
  return conversations.sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return (
      String(right.updatedAt ?? right.id).localeCompare(
        String(left.updatedAt ?? left.id),
      )
    );
  });
}

async function readConversationPayload() {
  await conversationWriteQueue.catch(() => undefined);
  const store = await readConversationStore();
  return {
    activeConversationId: store.activeConversationId,
    messages: parseConversationMarkdown(
      await readConversationSource(store.activeConversationId),
    ),
    conversations: await listConversations(store.activeConversationId),
  };
}

function rememberConversation(message, conversationId = null) {
  conversationWriteQueue = conversationWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const store = await readConversationStore();
      const targetId = conversationId ?? store.activeConversationId;
      const source = await readConversationSource(targetId);
      await writeText(
        conversationPath(targetId),
        appendConversationMarkdown(source, {
          ...message,
          timestamp: new Date().toISOString(),
        }),
      );
    });
  return conversationWriteQueue;
}

async function createConversation() {
  await conversationWriteQueue.catch(() => undefined);
  const store = await readConversationStore();
  const currentMessages = parseConversationMarkdown(
    await readConversationSource(store.activeConversationId),
  );
  if (currentMessages.length === 0) return readConversationPayload();

  const id = newConversationId();
  await writeText(conversationPath(id), emptyConversationMarkdown());
  store.activeConversationId = id;
  store.conversations[id] = {};
  await writeJson(sessionPath, store);
  return readConversationPayload();
}

async function activateConversation(id) {
  if (!isConversationId(id)) throw new Error("Invalid conversation identifier.");
  await conversationWriteQueue.catch(() => undefined);
  await readFile(conversationPath(id), "utf8");
  const store = await readConversationStore();
  store.activeConversationId = id;
  store.conversations[id] ??= {};
  await writeJson(sessionPath, store);
  return readConversationPayload();
}

async function readTestReportOrNull() {
  try {
    const markdown = await readFile(testReportPath, "utf8");
    const frontMatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const values = {};
    for (const line of frontMatter?.[1].split(/\r?\n/) ?? []) {
      const separator = line.indexOf(":");
      if (separator !== -1) {
        values[line.slice(0, separator).trim()] = line
          .slice(separator + 1)
          .trim();
      }
    }
    return {
      verdict: values.verdict ?? "risk",
      agent: values.agent ?? "codex",
      loopRevision: Number(values["loop-revision"]) || null,
      testedAt: values["tested-at"] ?? null,
      report: markdown.slice(frontMatter?.[0].length ?? 0).trim(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function newRunId() {
  return `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function runPath(id) {
  if (!/^run-\d+-[a-f0-9-]+$/.test(String(id ?? ""))) {
    throw new Error("Invalid run identifier.");
  }
  return path.join(runsDir, `${id}.md`);
}

function serializeRunMarkdown(run) {
  return `---
loopit-run: 1
run-id: ${run.id}
loop-revision: ${run.loopRevision}
agent: ${run.agent}
status: ${run.status}
started-at: ${run.startedAt}
finished-at: ${run.finishedAt ?? ""}
session-id: ${run.sessionId ?? ""}
---

# Loop run

## Objective

${run.objective}

## Worker report

${run.summary || "The worker is starting from the tested loop definition."}
`;
}

async function writeRun(run) {
  await writeText(runPath(run.id), serializeRunMarkdown(run));
}

async function readLatestRunOrNull() {
  const files = (await readdir(runsDir))
    .filter((name) => /^run-\d+-[a-f0-9-]+\.md$/.test(name))
    .sort();
  const latest = files.at(-1);
  if (!latest) return null;
  const markdown = await readFile(path.join(runsDir, latest), "utf8");
  const frontMatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const values = {};
  for (const line of frontMatter?.[1].split(/\r?\n/) ?? []) {
    const separator = line.indexOf(":");
    if (separator !== -1) {
      values[line.slice(0, separator).trim()] = line
        .slice(separator + 1)
        .trim();
    }
  }
  const report = markdown.match(/\n## Worker report\s*\n\n([\s\S]*)$/)?.[1]?.trim();
  return {
    id: values["run-id"] ?? latest.slice(0, -3),
    loopRevision: Number(values["loop-revision"]) || null,
    agent: values.agent ?? "codex",
    status: values.status ?? "stopped",
    startedAt: values["started-at"] ?? null,
    finishedAt: values["finished-at"] || null,
    summary: report ?? "",
  };
}

async function detectAgent(command) {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], {
      cwd: projectRoot,
      timeout: 4000,
    });
    return {
      installed: true,
      version: (stdout || stderr).trim(),
    };
  } catch {
    return { installed: false, version: null };
  }
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return false;
  response.setHeader(
    "Access-Control-Allow-Origin",
    origin && allowedOrigins.has(origin) ? origin : "http://localhost:3000",
  );
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return true;
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function constructionPrompt({ message, selectedElementId }) {
  const selected = selectedElementId
    ? `The user currently selected loop element: ${selectedElementId}.`
    : "The user has not selected a particular loop element.";

  return `You are the loop-construction supervisor inside Loopit.

Your only task is to help the user construct and debug a minimal continuing-work loop. You may inspect this repository and its README for context. You MUST only create or update .loopit/loop.md. Do not modify application code, documentation, configuration, or any other file. Do not execute the proposed loop.

If .loopit/loop.md does not exist, this is first-time initialization. Do not treat the missing file as an error. If the user has not stated a concrete objective yet, ask one focused question about what work they want to keep progressing; do not invent or create a loop prematurely. Once the objective is clear enough, create the smallest useful proposal.

Before drafting, explicitly distinguish two things:
- The product, system, organization, or outcome being described.
- The work that this loop itself should repeatedly advance.

Classify the loop subject before choosing states. If the user says build, create, develop, implement, or make an app, product, or agent, default to a development loop unless they explicitly say the system already exists and they want to run or operate it. The future product behavior becomes capability requirements, acceptance scenarios, and test evidence; do not turn those future operations into the recurring states of the development loop. For example, "build an agent that continuously searches and applies for jobs" means capability gap -> feature slice -> implementation -> sandbox evaluation -> updated product state, not search jobs -> submit applications -> read email.

An operating loop is appropriate only when the user explicitly asks to operate an existing system or makes that intent otherwise unambiguous. If build and operate are both genuinely plausible and the distinction would change the phases or deliverables, ask exactly one focused question before writing: whether the loop should build and improve the system or operate it after it exists. If the user wants both, keep them as separate loops and construct development first unless the user prioritizes operation.

When a loop exists, read .loopit/loop.md before responding. Markdown is the only durable source of truth; never create a JSON copy. Preserve its constrained, readable structure:
- YAML front matter with loopit, revision, status, completion-policy, and start.
- One H1 loop name and an H2 Objective.
- One H2 Starting Package immediately after Objective. It contains exactly four H3 entries with bold ID, Role, and Description fields plus an H4 Initial Contents list. Allowed roles are state, frontier, foundation, and first-work.
- One H2 Artifacts section, with H3 entries and bold ID and Description fields.
- One separate H2 Boundaries section, with H3 entries and bold ID, Kind, and Description fields. Never combine Artifacts and Boundaries under one heading.
- H2 States, with one H3 per state and bold ID, Kind, and Summary fields.
- Each state keeps H4 Reads, Instruction, Writes, Completion, and Transitions sections.
- Reads and Writes are Markdown lists.
- Transitions use the existing four-column Markdown table: Next state, When, Kind, and ID.
- Allowed state kinds: observe, decide, act, evaluate, challenge, update, interrupt, terminal.
- Allowed transition kinds: normal, continue, interrupt, complete.
- Increment revision after a meaningful change.

Construction principles:
1. Keep the loop as small as possible.
2. Treat State and frontier -> Work contract -> Result package -> Integrated state and frontier -> repeat as an internal construction invariant, not a fixed workflow and not user-facing terminology. Use it to check continuity after you have designed the concrete loop.
3. Infer the user's profession or work function, project type, chosen loop subject, and natural recurring work cycle from their objective and the repository. Different work and different subjects of the same product should have different structures. Use only phases practitioners actually recognize; three to seven recurring states is usually enough, but never force a count.
4. Use established professional vocabulary, not newly coined Loopit vocabulary. First reuse terms already present in the repository, team documents, tools, tickets, or reports. If none exist, use the plain, widely recognized terms of that profession. Keep visible state and artifact names short—normally two to six words—and prefer ordinary verb-plus-noun stage names. A software developer should see a recognizable development cycle such as Backlog -> Plan feature -> Implement -> Test -> Review or merge -> Update backlog. A researcher should see Hypothesis -> Method or experiment plan -> Experiment -> Data -> Analysis -> Update beliefs and hypotheses. A designer should see User problem or research finding -> Design brief -> Wireframe or prototype -> Usability test or critique -> Design decision and next question. Do not invent compound phrases such as Frame capability slice, Capability evidence map, Product review disposition, Frontier replenishment, or similar terminology unless the user's field already uses that exact term. Never mix development and operation into one apparent cycle.
5. The web UI displays H3 state names, Starting Package item names and contents, summaries, artifact names, and handoffs directly. Write all of them so a practitioner can understand the overview without a Loopit glossary. Generic visible names such as Select work, Execute work, Integrate result, Work contract, Result package, Updated state, or internal control language are an unfinished draft. "Starting Package" and its Role values are internal Markdown structure, not user-facing vocabulary.
6. Separate the user's starting work from setup. The UI groups state, frontier, and first-work above the cycle as Starting work; it renders foundation after the cycle as Setup. Starting work must contain the concrete objects the user cares about, not broad directions or setup chores:
   - state: an itemized current status in the profession's language. For research, list specific hypotheses or claims with supported, contradicted, or uncertain status and cite available evidence. For software, list specific user-visible features with implemented, partial, failing, or not-started status. For design, list concrete screens, flows, findings, or decisions and their status. For other work, list the actual cases, opportunities, decisions, or deliverables being tracked.
   - frontier: several specific initial items ready to pursue, not umbrella categories. Use actual hypotheses, features, design questions, experiments, accounts, campaigns, cases, or decisions. Derive them from the objective and available evidence. When useful, inspect available literature or prior work and propose clearly labeled candidates; never fabricate a source.
   - first-work: one exact item selected from that list, already developed into a concrete first task. For research, include a testable hypothesis and proposed method or minimal experiment. For software, include a bounded feature and acceptance tests. For design, include the target user flow or screen and evaluation. It must be executable with the setup and produce the loop's declared handoff.
   - foundation: a separate, concrete Setup specification. Inspect the workspace and record what already exists, then choose safe reversible defaults for what is missing. Do not leave choices as TBD, "choose later," or another question the agent can resolve. For research, specify the data or sample, method, baseline, evaluation metric, minimal experiment, and exact initial model family and size or a precise selection rule when models are relevant. For software, specify the existing or proposed stack, repository conventions, test command, fixtures, local services, and branch or build workflow. For UI/UX, specify the design tool, platform and viewport, design system, prototype fidelity, research participants or critique method, and success criteria. For business work, specify data sources, time horizon, channel, metric, budget or authority boundary, and working template.
7. Complete both Starting work and Setup in the same construction turn once the objective is clear. Do not make the user ask a second round for initial hypotheses, features, experiments, model choices, baselines, tools, or tests. Do not ask a nonexpert to choose raw tools, technical architecture, methodology, or infrastructure from scratch. Ask only when cost, authority, risk, private information, or a materially different direction is human-owned. Initial claims and proposed setup must be labeled honestly; never present an unverified resource as already available.
   Keep Initial Contents scannable in the web tables: begin each line with a short established label or identifier in backticks, then an em dash and its status or specification, such as \`H1 — Weak visual sensitivity · untested\` — explanation, \`Login · not started\` — acceptance gap, or \`Model\` — Qwen2.5-VL-3B. The label is for recognition, not a place to invent terminology.
8. Discover the domain's native deliverables before inventing files. Inspect existing work for reports, commits, pull requests, builds, test results, tickets, design versions, prototypes, spreadsheets, CRM records, decision memos, or other established handoffs. Identify who or what produces and consumes each deliverable and what decision it enables. Add only the thin documentation needed for a fresh agent or human to consume it.
9. Internally, center the loop on one portable result artifact, but give it the ordinary name used in the field: Experiment report or Data and analysis for research; Working code, Test results, or Pull request for software; Prototype and Usability findings for design. Never expose Result package, Feature result, Change result, or Design evaluation packet merely because Loopit needs a generic container. It must reference its bounded task, identify the native deliverable, carry observable evidence, record completed|partial|failed|blocked outcome, capture unresolved findings and follow-up work, and include enough source information for another agent or session to inspect it.
10. Negative outcomes are valid domain results. Expected product failures, failed tests, rejected hypotheses, and blocked actions go to the same judgment or integration phase as successful work; do not create a branch for every outcome.
11. Keep the visible States section about the concrete domain work only. Starting Package preparation and setup happen before the start state. Retry and interrupted-session recovery resume the current state from durable artifacts. Human interruption, budgets, permissions, and completion acceptance belong in Boundaries and the completion policy, not as repeated outgoing states. Add an interrupt or terminal state only when the Markdown graph needs a concrete boundary target, and keep it outside the recurring cycle.
12. Every ordinary handoff must use the same project-specific artifact name in the source Writes and consumer Reads. A fresh consumer must not need hidden chat context.
13. Define a frontier replenishment contract in the domain's language. Every newly created frontier item must cite the objective criterion, requirement, question, or declared outcome it advances and the result, observation, failed check, missing evidence, or explicit human scope change that caused it. It must also state why the item is unresolved and what evidence would retire it. Never replenish the frontier with unrelated ideas merely to keep the loop running.
14. Define the empty-frontier protocol. The final recurring phase must compare durable state and evidence with the objective, then produce exactly one justified outcome: one or more objective-backed frontier items, a scheduled observation when external change is expected, one human-owned decision, or a completion candidate. An empty current queue is not permission to stop silently, and a back edge without a replenishment source is not a continuing loop.
15. The final recurring phase must interpret the domain result, update durable project state, apply the replenishment contract, and produce either another justified project-specific starting handoff or a declared runtime boundary.
16. Propose the best concrete loop rather than asking the human to design it manually. State the classified loop subject in the response. Ask a focused question only when the missing choice would materially change its subject, Starting Package, phases, deliverables, authority, or result contract. Explain the proposed cycle in one short project-specific sequence so the human can correct it.
17. Choose one completion policy and record it in front matter: \`confirm\` by default for product and engineering work, \`automatic\` only when declared evidence can decide safely, or \`continuous\` for open-ended work that replenishes its frontier. Challenge and acceptance are invoked by the runtime only when integration produces a completion candidate; they do not need permanent domain states.
18. Never claim hypothetical runtime evidence already exists. Record how the domain result would carry it and let a later sandbox test prove it.
19. After editing the file, respond conversationally with the loop subject, the profession-named starting work, separately specified setup, recognizable recurring cycle, native deliverable, source of new work, and the most important remaining uncertainty. Use the profession's vocabulary rather than the engine terms Starting Package, state, frontier, foundation, Work contract, or Result package unless the user explicitly asks about Loopit's internal model. Do not repeat invented terms from IDs or internal descriptions. Keep the reply concise.

${selected}

User message:
${message}`;
}

function commandFor(agent, sessionId, prompt) {
  if (agent === "claude") {
    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read,Glob,Grep,Edit,Write",
      "--disallowedTools",
      "Bash",
    ];
    if (sessionId) args.push("--resume", sessionId);
    return { command: "claude", args, input: prompt };
  }

  const modelArgs = process.env.LOOPIT_CODEX_MODEL
    ? ["--model", process.env.LOOPIT_CODEX_MODEL]
    : [];

  if (sessionId) {
    return {
      command: "codex",
      args: ["exec", "resume", "--json", ...modelArgs, sessionId, "-"],
      input: prompt,
    };
  }

  return {
    command: "codex",
    args: [
      "exec",
      "--json",
      ...modelArgs,
      "--sandbox",
      "workspace-write",
      "-C",
      projectRoot,
      "-",
    ],
    input: prompt,
  };
}

function rehearsalCommandFor(agent, prompt) {
  if (agent === "claude") {
    return {
      command: "claude",
      args: [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "plan",
        "--allowedTools",
        "Read,Glob,Grep",
        "--disallowedTools",
        "Bash,Edit,Write",
        "--no-session-persistence",
      ],
      input: prompt,
    };
  }

  const modelArgs = process.env.LOOPIT_CODEX_MODEL
    ? ["--model", process.env.LOOPIT_CODEX_MODEL]
    : [];
  return {
    command: "codex",
    args: [
      "exec",
      "--json",
      "--ephemeral",
      ...modelArgs,
      "--sandbox",
      "read-only",
      "--output-last-message",
      testOutputPath,
      "-C",
      projectRoot,
      "-",
    ],
    input: prompt,
  };
}

function runtimeCommandFor(agent, prompt) {
  if (agent === "claude") {
    return {
      command: "claude",
      args: [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read,Glob,Grep,Edit,Write,Bash",
      ],
      input: prompt,
    };
  }

  const modelArgs = process.env.LOOPIT_CODEX_MODEL
    ? ["--model", process.env.LOOPIT_CODEX_MODEL]
    : [];
  return {
    command: "codex",
    args: [
      "exec",
      "--json",
      ...modelArgs,
      "--sandbox",
      "workspace-write",
      "-C",
      projectRoot,
      "-",
    ],
    input: prompt,
  };
}

function runtimePrompt(runId) {
  return `You are the worker for Loopit run ${runId}. The loop definition has passed construction testing for its current revision.

Read .loopit/loop.md and .loopit/runs/${runId}.md. Execute the loop; do not redesign it and do not edit .loopit/loop.md, .loopit/test-report.md, conversation history, or another run record.

Begin from the declared first work and start state. Follow the state instructions, named handoffs, setup, authority boundaries, retry rules, and completion policy. Use durable project artifacts as the source of truth. Perform real project work with the tools available in this local workspace. Keep moving through useful iterations until you reach an explicit human decision, permission boundary, completion condition, unrecoverable blocker, or this worker turn ends. Never invent credentials, private facts, evidence, or permission, and never bypass an external safeguard.

End with a concise worker report describing the state reached, durable artifacts changed, evidence collected, and exact next state or human decision. Do not claim the overall loop is complete unless its declared completion policy is satisfied.`;
}

function rehearsalPrompt() {
  return `You are the independent test supervisor for a Loopit loop.

Read .loopit/loop.md as if you were a fresh agent with no conversation history. You may inspect referenced project files when they exist, but this is a read-only rehearsal: do not modify files, run the proposed work, call external services, or claim that hypothetical evidence is real. Ignore any previous .loopit/test-report.md.

Test whether the loop's control contract can continue safely:
1. Identify the product or outcome being described, the work the loop itself advances, and whether the loop subject is development, operation, research, design, or another mode. Fail a loop that chose the wrong layer—for example, operational job searching when the user's stated intent is to build a job-search agent.
2. Inspect Starting work before tracing the cycle. State and frontier must itemize the concrete objects the user cares about—specific hypotheses and their initial evidence status, features and implementation status, design questions or decisions, opportunities, campaigns, accounts, cases, or equivalent—not merely broad capability areas, project basics, or setup chores. Verify that first-work selects one exact listed item and already specifies an executable first experiment, feature, design evaluation, or other bounded task. Fail a loop that would require another user prompt merely to obtain its initial hypotheses, features, or first method.
3. Inspect Setup separately. Verify that the foundation names concrete choices sufficient to begin first-work rather than saying choose later, set up infrastructure, establish a baseline, or other placeholders. For research, require the relevant data or sample, method, baseline, evaluation metric, minimal experiment, and concrete model family and size or selection rule. For software, require the actual stack, test command, fixtures, needed local services, and development workflow. For UI/UX or business, require the relevant tool, material or data, evaluation method, metrics, and authority limits. Verify that the agent chose safe reversible defaults instead of pushing raw methodology, tool, infrastructure, or architecture selection onto a nonexpert. Surface only cost, authority, risk, private information, and materially different directions as human-owned decisions. Treat proposed unproven resources as plans, not observed evidence.
4. Identify the recurring domain cycle and ignore Starting Package setup or runtime handlers when describing it. State and frontier -> Work contract -> Result package -> Integrated state and frontier is only the invariant you use to check the cycle; report the actual project-specific phases and artifacts.
5. Check that every visible state name, summary, artifact, and handoff uses established vocabulary from the user's profession or existing project. Fail both generic engine language and newly invented compound jargon. In software, reject names such as Frame capability slice, Capability evidence map, Product review disposition, or Feature result when familiar terms such as Plan feature, Product status, Review decision, Working code, and Test results express the same meaning. In research, expect familiar terms such as Hypothesis, Method, Experiment, Data, Analysis, and Belief update. Do not force every domain into the same number of states and do not mix development with operation.
6. Identify the domain's native deliverable and portable result. Fail the loop if the result is only chat prose, if its deliverable is unclear, if it uses an invented Loopit name despite a familiar professional term, or if a fresh consumer cannot find and inspect it.
7. Trace artifact ownership across one recurrence. Each project-specific producer must write the same named artifact its consumer reads; the domain result must reach judgment or integration; integration must update project state and replenish the frontier.
8. Trace every newly created frontier item back to both an objective criterion and causal evidence. Fail a loop that can invent unrelated work, duplicate resolved work, or continue without stating what evidence would retire the item.
9. Exhaust the current frontier in rehearsal. Verify that the empty-frontier protocol compares state with the objective and produces objective-backed work, scheduled observation, one human decision, or a completion candidate. Fail a loop that stops merely because its initial list is empty or loops back without a source of new work.
10. Test that completed, partial, failed, and blocked work all produce consumable domain results and reach integration without creating outcome-specific branch explosions.
11. Start a hypothetical fresh agent at each handoff using only declared durable artifacts. Check whether it can identify the contract, deliverable, evidence, outcome, provenance, and next responsibility without the construction conversation.
12. Evaluate setup, retries, interrupted-session recovery, human authority, budget, and completion as runtime policies separately. Do not require them to appear as ordinary domain states. Verify only that each policy has a durable resume or stop contract and cannot silently masquerade as successful work.
13. Distinguish construction proof from untested production behavior. A construction rehearsal may pass when the loop names a concrete later sandbox test, the evidence it must collect, and failure routing; do not pretend that later runtime behavior already passed. Missing runtime evidence alone is not a RISK when that proof path is explicit.
14. For completion, verify that integration creates only a candidate and the declared runtime policy performs any required challenge or human acceptance. A challenge does not need to be a permanent graph state.

A non-PASS verdict is not a terminal outcome. It means the finding becomes the next construction action: agent-owned gaps should be repaired, human-owned gaps should become one focused question, and runtime-evidence gaps should become an explicit test action with failure routing.

Return a concise Markdown report. The first line must be exactly one of:
Verdict: PASS
Verdict: RISK
Verdict: FAIL

Then use these headings:
# Fresh-agent loop rehearsal
## Ordinary recurrence
## State contract risks
## Edge cases
## Ownership and next action
## What this test does not prove

Name exact state IDs and transition IDs. PASS completes "Test this loop" for the current revision: the loop is resumable, every challenged case has an explicit route, no construction decision remains, and any later runtime proof has a concrete test and failure route. RISK means the construction contract is coherent but unresolved human intent, authority, private information, cost, or risk judgment prevents it from being final. Runtime proof by itself does not lower PASS to RISK when its later test path is explicit. FAIL means agent-resolvable control flow has a dead end, missing recurrence, unusable transition, or missing proof path. For RISK or FAIL, the Ownership and next action section must contain these exact H3 subsections: "Agent resolves now", "Ask human", and "Sandbox must prove", using "None" where a category is empty.

When Ask human is not None, make that subsection directly renderable as a decision panel using exactly this structure:
### Ask human
Question: one focused question the user can answer now
Recommendation: the safest useful default and why it is preferred
Why human: the intent, authority, private fact, cost, or risk judgment the agent cannot own
Options:
- the recommended concrete option, matching the Recommendation
- one concrete alternative

Do not hide a required human decision in another section or in conversational prose. When Ask human is None, write only "### Ask human" followed by "None."`;
}

function rehearsalVerdict(report) {
  const match = report.match(/^Verdict:\s*(PASS|RISK|FAIL)\s*$/im);
  return match?.[1].toLowerCase() ?? "risk";
}

function readableProviderError(event, agent) {
  const raw =
    event?.error?.error?.message ??
    event?.error?.message ??
    event?.result ??
    event?.message;
  if (typeof raw !== "string" || !raw.trim()) {
    return `The ${agent === "codex" ? "Codex" : "Claude"} turn failed.`;
  }

  if (raw.includes("requires a newer version of Codex")) {
    return `${raw} Run \`codex update\`, or set LOOPIT_CODEX_MODEL to a model supported by your installed CLI.`;
  }

  return raw;
}

function eventLabel(event) {
  const item = event.item;
  if (!item) return null;

  if (item.type === "command_execution") {
    return item.status === "in_progress"
      ? "Inspecting the project"
      : "Project inspection finished";
  }
  if (item.type === "file_change") return "Updating the loop proposal";
  if (item.type === "mcp_tool_call") return "Reading project context";
  if (item.type === "reasoning") return "Reconsidering the loop structure";
  return null;
}

function runtimeEventLabel(event) {
  const item = event.item;
  if (!item) return null;
  if (item.type === "command_execution") {
    return item.status === "in_progress"
      ? "Running project work"
      : "Project command finished";
  }
  if (item.type === "file_change") return "Updating project artifacts";
  if (item.type === "mcp_tool_call") return "Using a connected tool";
  if (item.type === "reasoning") return "Planning the next loop step";
  return null;
}

async function streamConstruction(request, response) {
  if (activeRun) {
    json(response, 409, { error: "The construction agent is already working." });
    return;
  }

  const body = await readBody(request);
  const agent = body.agent === "claude" ? "claude" : "codex";
  const message = String(body.message || "").trim();
  if (!message) {
    json(response, 400, { error: "A message is required." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const send = (event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const conversationStore = await readConversationStore();
  const conversationId = conversationStore.activeConversationId;

  await rememberConversation({
    role: "user",
    text: String(body.displayText || message).trim(),
  }, conversationId);

  const sessions = conversationStore.conversations[conversationId] ?? {};
  const sessionId = sessions?.[agent]?.sessionId ?? null;
  const prompt = constructionPrompt({
    message,
    selectedElementId: body.selectedElementId,
  });
  const invocation = commandFor(agent, sessionId, prompt);

  send({ type: "status", text: `Starting ${agent === "codex" ? "Codex" : "Claude"}` });

  const child = spawn(invocation.command, invocation.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(invocation.input);

  activeRun = { child, agent };
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let discoveredSessionId = sessionId;
  let finalMessageSent = false;
  let providerErrorSent = false;

  const handleEvent = async (event) => {
    if (agent === "codex") {
      if (event.type === "thread.started" && event.thread_id) {
        discoveredSessionId = event.thread_id;
      }
      const label = eventLabel(event);
      if (label && event.type === "item.started") {
        send({ type: "activity", text: label });
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        finalMessageSent = true;
        send({ type: "agent_message", text: event.item.text });
        void rememberConversation({
          role: "agent",
          source: agent,
          text: event.item.text,
        });
      }
      if (event.type === "turn.failed") {
        providerErrorSent = true;
        const text = readableProviderError(event, agent);
        send({ type: "error", text });
        void rememberConversation({ role: "error", text });
      }
      if (event.type === "error") {
        providerErrorSent = true;
        const text = readableProviderError(event, agent);
        send({ type: "error", text });
        void rememberConversation({ role: "error", text });
      }
      return;
    }

    if (event.type === "system" && event.subtype === "init" && event.session_id) {
      discoveredSessionId = event.session_id;
    }
    if (event.type === "assistant") {
      const blocks = event.message?.content ?? [];
      const tool = blocks.find((block) => block.type === "tool_use");
      if (tool) send({ type: "activity", text: `Using ${tool.name}` });
    }
    if (event.type === "result") {
      if (event.result) {
        finalMessageSent = true;
        send({ type: "agent_message", text: event.result });
        void rememberConversation({
          role: "agent",
          source: agent,
          text: event.result,
        });
      }
      if (event.is_error) {
        providerErrorSent = true;
        const text = readableProviderError(event, agent);
        send({ type: "error", text });
        void rememberConversation({ role: "error", text });
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        void handleEvent(JSON.parse(line));
      } catch {
        // Provider diagnostics are not part of the normalized event stream.
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-12_000);
  });

  child.on("error", (error) => {
    const text = `${invocation.command} could not be started: ${error.message}`;
    send({ type: "error", text });
    void rememberConversation({ role: "error", text });
  });

  child.on("close", async (code, signal) => {
    activeRun = null;

    if (discoveredSessionId) {
      sessions[agent] = {
        sessionId: discoveredSessionId,
        updatedAt: new Date().toISOString(),
      };
      conversationStore.conversations[conversationId] = sessions;
      await writeJson(sessionPath, conversationStore);
    }

    if (code !== 0 && signal !== "SIGTERM" && !providerErrorSent) {
      const detail = stderrBuffer
        .trim()
        .split("\n")
        .slice(-3)
        .join("\n");
      send({
        type: "error",
        text: detail || `${invocation.command} exited with code ${code}.`,
      });
      void rememberConversation({
        role: "error",
        text: detail || `${invocation.command} exited with code ${code}.`,
      });
    }

    try {
      const loop = await readLoopOrNull();
      if (loop) send({ type: "loop_updated", loop });
    } catch (error) {
      send({
        type: "error",
        text: `The loop Markdown could not be parsed: ${error instanceof Error ? error.message : "Unknown parsing error."}`,
      });
      void rememberConversation({
        role: "error",
        text: `The loop Markdown could not be parsed: ${error instanceof Error ? error.message : "Unknown parsing error."}`,
      });
    }
    if (!finalMessageSent && code === 0) {
      const text =
        "The loop proposal was updated. Inspect the changed states and validation findings on the right.";
      send({ type: "agent_message", text });
      void rememberConversation({ role: "agent", source: agent, text });
    }
    await conversationWriteQueue.catch(() => undefined);
    send({ type: "done", interrupted: signal === "SIGTERM" });
    response.end();
  });
}

async function streamRehearsal(request, response) {
  if (activeRun) {
    json(response, 409, { error: "Another local agent is already working." });
    return;
  }

  const loop = await readLoopOrNull();
  if (!loop) {
    json(response, 400, { error: "Construct a loop before testing it." });
    return;
  }

  const body = await readBody(request);
  const agent = body.agent === "claude" ? "claude" : "codex";
  const invocation = rehearsalCommandFor(agent, rehearsalPrompt());
  await unlink(testOutputPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({
    type: "status",
    text: `Starting a fresh, read-only ${agent === "codex" ? "Codex" : "Claude"} rehearsal`,
  });

  const child = spawn(invocation.command, invocation.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(invocation.input);
  activeRun = { child, agent, purpose: "test" };

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let claudeReport = "";
  let providerErrorSent = false;

  const handleEvent = (event) => {
    if (agent === "codex") {
      const label = eventLabel(event);
      if (label && event.type === "item.started") {
        send({ type: "activity", text: label });
      }
      if (event.type === "turn.failed" || event.type === "error") {
        providerErrorSent = true;
        const text = readableProviderError(event, agent);
        send({ type: "error", text });
        void rememberConversation({ role: "error", text });
      }
      return;
    }

    if (event.type === "assistant") {
      const blocks = event.message?.content ?? [];
      const tool = blocks.find((block) => block.type === "tool_use");
      if (tool) send({ type: "activity", text: `Inspecting with ${tool.name}` });
    }
    if (event.type === "result") {
      if (event.result) claudeReport = event.result;
      if (event.is_error) {
        providerErrorSent = true;
        const text = readableProviderError(event, agent);
        send({ type: "error", text });
        void rememberConversation({ role: "error", text });
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch {
        // Only normalized provider events are used by the rehearsal UI.
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-12_000);
  });

  child.on("error", (error) => {
    const text = `${invocation.command} could not be started: ${error.message}`;
    send({ type: "error", text });
    void rememberConversation({ role: "error", text });
  });

  child.on("close", async (code, signal) => {
    activeRun = null;
    const interrupted = signal === "SIGTERM";

    if (code !== 0 && !interrupted && !providerErrorSent) {
      const detail = stderrBuffer.trim().split("\n").slice(-3).join("\n");
      const text = detail || `${invocation.command} exited with code ${code}.`;
      send({ type: "error", text });
      void rememberConversation({ role: "error", text });
    }

    if (code === 0 && !interrupted) {
      try {
        const report =
          agent === "codex"
            ? (await readFile(testOutputPath, "utf8")).trim()
            : claudeReport.trim();
        if (!report) throw new Error("The test agent returned an empty report.");

        const verdict = rehearsalVerdict(report);
        const testedAt = new Date().toISOString();
        const markdown = `---
loopit-test: 1
loop-revision: ${loop.revision}
tested-at: ${testedAt}
agent: ${agent}
verdict: ${verdict}
---

${report.trim()}
`;
        await writeText(testReportPath, markdown);
        const result = {
          verdict,
          agent,
          loopRevision: loop.revision,
          testedAt,
          report: report.trim(),
        };
        send({ type: "test_report", result });
        await rememberConversation({
          role: "loopit",
          text: verdict === "pass"
            ? `Loop test passed for revision ${loop.revision}.`
            : `Loop test found issues in revision ${loop.revision}. Loopit will repair agent-owned issues automatically or open a human review with a recommended next step.`,
        });
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "The rehearsal report was lost.";
        send({ type: "error", text });
        await rememberConversation({ role: "error", text });
      }
    }

    await unlink(testOutputPath).catch((error) => {
      if (error?.code !== "ENOENT") console.error(error);
    });
    await conversationWriteQueue.catch(() => undefined);
    send({ type: "done", interrupted });
    response.end();
  });
}

async function streamRuntime(request, response) {
  if (activeRun) {
    json(response, 409, { error: "Another local agent is already working." });
    return;
  }

  const [loop, test] = await Promise.all([
    readLoopOrNull(),
    readTestReportOrNull(),
  ]);
  if (!loop) {
    json(response, 400, { error: "Construct a loop before starting it." });
    return;
  }
  if (test?.verdict !== "pass" || test.loopRevision !== loop.revision) {
    json(response, 409, {
      error: `Pass Test this loop for revision ${loop.revision} before starting runtime.`,
    });
    return;
  }

  const body = await readBody(request);
  const agent = body.agent === "claude" ? "claude" : "codex";
  const run = {
    id: newRunId(),
    loopRevision: loop.revision,
    objective: loop.objective,
    agent,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sessionId: null,
    summary: "",
  };
  await writeRun(run);

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event) => {
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  const invocation = runtimeCommandFor(agent, runtimePrompt(run.id));
  send({
    type: "run_started",
    run: {
      id: run.id,
      loopRevision: run.loopRevision,
      agent: run.agent,
      active: true,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: null,
      summary: "",
    },
  });
  send({ type: "activity", text: "Starting the first loop worker" });

  const child = spawn(invocation.command, invocation.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(invocation.input);
  activeRun = { child, agent, purpose: "runtime", runId: run.id };

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalSummary = "";
  let discoveredSessionId = null;
  let providerError = "";

  const handleEvent = (event) => {
    if (agent === "codex") {
      if (event.type === "thread.started" && event.thread_id) {
        discoveredSessionId = event.thread_id;
      }
      const label = runtimeEventLabel(event);
      if (label && event.type === "item.started") {
        send({ type: "activity", text: label });
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        finalSummary = event.item.text;
        send({ type: "agent_message", text: finalSummary });
      }
      if (event.type === "turn.failed" || event.type === "error") {
        providerError = readableProviderError(event, agent);
        send({ type: "error", text: providerError });
      }
      return;
    }

    if (event.type === "system" && event.subtype === "init" && event.session_id) {
      discoveredSessionId = event.session_id;
    }
    if (event.type === "assistant") {
      const blocks = event.message?.content ?? [];
      const tool = blocks.find((block) => block.type === "tool_use");
      if (tool) send({ type: "activity", text: `Using ${tool.name}` });
    }
    if (event.type === "result") {
      if (event.result) {
        finalSummary = event.result;
        send({ type: "agent_message", text: finalSummary });
      }
      if (event.is_error) {
        providerError = readableProviderError(event, agent);
        send({ type: "error", text: providerError });
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch {
        // Only normalized provider events are shown in the runtime UI.
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-12_000);
  });

  child.on("error", (error) => {
    providerError = `${invocation.command} could not be started: ${error.message}`;
    send({ type: "error", text: providerError });
  });

  child.on("close", async (code, signal) => {
    activeRun = null;
    const interrupted = signal === "SIGTERM";
    const failure =
      providerError ||
      (code && code !== 0
        ? stderrBuffer.trim().split("\n").slice(-3).join("\n") ||
          `${invocation.command} exited with code ${code}.`
        : "");
    run.status = interrupted ? "interrupted" : failure ? "failed" : "paused";
    run.finishedAt = new Date().toISOString();
    run.sessionId = discoveredSessionId;
    run.summary =
      finalSummary ||
      failure ||
      (interrupted
        ? "The worker was stopped by the user. Durable project artifacts remain available for a later resume."
        : "The worker turn ended. Inspect the durable artifacts before resuming runtime.");
    await writeRun(run);
    const publicRun = {
      id: run.id,
      loopRevision: run.loopRevision,
      agent: run.agent,
      active: false,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: run.summary,
    };
    send({ type: "run_updated", run: publicRun });
    send({ type: "done", interrupted });
    response.end();
  });
}

const server = http.createServer(async (request, response) => {
  if (!setCors(request, response)) {
    json(response, 403, { error: "Origin is not allowed." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      const [codex, claude] = await Promise.all([
        detectAgent("codex"),
        detectAgent("claude"),
      ]);
      json(response, 200, {
        ok: true,
        projectRoot,
        active: Boolean(activeRun),
        activePurpose: activeRun?.purpose ?? null,
        agents: { codex, claude },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/loop") {
      const loop = await readLoopOrNull();
      json(response, 200, { loop });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/conversation") {
      json(response, 200, await readConversationPayload());
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/conversations/new"
    ) {
      if (activeRun) {
        json(response, 409, {
          error: "Stop the active agent before starting a new conversation.",
        });
        return;
      }
      json(response, 200, await createConversation());
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/conversations/activate"
    ) {
      if (activeRun) {
        json(response, 409, {
          error: "Stop the active agent before changing conversations.",
        });
        return;
      }
      const body = await readBody(request);
      json(response, 200, await activateConversation(String(body.id || "")));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/conversation") {
      const body = await readBody(request);
      const role = body.role === "error" ? "error" : "loopit";
      const text = String(body.text || "").trim();
      if (!text) {
        json(response, 400, { error: "A conversation message is required." });
        return;
      }
      await rememberConversation({ role, text });
      json(response, 200, { saved: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/test") {
      json(response, 200, { result: await readTestReportOrNull() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/run") {
      const run = await readLatestRunOrNull();
      const active = Boolean(
        run &&
          activeRun?.purpose === "runtime" &&
          activeRun.runId === run.id,
      );
      json(response, 200, {
        run: run
          ? {
              ...run,
              active,
              status: run.status === "running" && !active
                ? "interrupted"
                : run.status,
            }
          : null,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/loop") {
      if (activeRun) {
        json(response, 409, {
          error: "Wait for the construction agent to finish before editing the loop.",
        });
        return;
      }
      const body = await readBody(request);
      if (!body.loop || typeof body.loop !== "object") {
        json(response, 400, { error: "A loop definition is required." });
        return;
      }
      const current = await readLoopOrNull();
      const candidate = {
        ...body.loop,
        schemaVersion: 1,
        revision:
          Math.max(Number(body.loop.revision) || 0, current?.revision ?? 0) + 1,
      };
      const markdown = serializeLoopMarkdown(candidate);
      const loop = parseLoopMarkdown(markdown);
      await writeText(loopPath, markdown);
      json(response, 200, { loop });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      await streamConstruction(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/test") {
      await streamRehearsal(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/run") {
      await streamRuntime(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/interrupt") {
      if (!activeRun) {
        json(response, 200, { interrupted: false });
        return;
      }
      activeRun.child.kill("SIGTERM");
      json(response, 200, { interrupted: true });
      return;
    }

    json(response, 404, { error: "Not found." });
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected daemon error.",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Loopit daemon: http://127.0.0.1:${port}`);
  console.log(`Project: ${projectRoot}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    activeRun?.child.kill("SIGTERM");
    server.close(() => process.exit(0));
  });
}
