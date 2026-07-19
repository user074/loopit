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

When a loop exists, read .loopit/loop.md before responding. Markdown is the only durable source of truth; never create a JSON copy. Preserve its constrained, readable structure:
- YAML front matter with loopit, revision, status, completion-policy, and start.
- One H1 loop name and an H2 Objective.
- H2 Artifacts and Boundaries, with H3 entries and bold ID, Kind, and Description fields.
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
3. Infer the user's job function, project type, and natural recurring work cycle from their objective and the repository. Different work should have different structures. Use only the domain phases needed for meaningful transformations or handoffs; three to seven recurring states is usually enough, but never force a count.
4. Name every recurring state and handoff in the project's native language. When the domain is known, generic visible names such as Select work, Execute work, Integrate result, Work contract, Result package, or Updated state are an unfinished draft. For research, prefer hypotheses, experiment plans, data, reports, verdicts, and belief updates. For app development, prefer capability gaps, feature slices, working builds, product review, and capability-map updates. Apply the same translation to engineering, UI/UX, business, or any other domain.
5. Discover the domain's native deliverables before inventing files. Inspect existing work for reports, commits, pull requests, testable builds, tickets, design versions, prototypes, spreadsheets, CRM records, decision memos, or other established handoffs. Identify who or what produces and consumes each deliverable and what decision it enables. Add only the thin documentation needed for a fresh agent or human to consume it.
6. Center the loop on one portable, domain-named Result package artifact: for example Experiment report, Feature result, Change result, or Design evaluation packet. It must reference its bounded input contract, identify the native deliverable, carry observable evidence, record completed|partial|failed|blocked outcome, capture unresolved findings and candidate follow-up work, and include enough provenance for another agent or session to inspect it.
7. Negative outcomes are valid domain results. Expected product failures, failed tests, rejected hypotheses, and blocked actions go to the same judgment or integration phase as successful work; do not create a branch for every outcome.
8. Keep the visible States section about the concrete domain work only. Setup happens before the start state. Retry and interrupted-session recovery resume the current state from durable artifacts. Human interruption, budgets, permissions, and completion acceptance belong in Boundaries and the completion policy, not as repeated outgoing states. Add an interrupt or terminal state only when the Markdown graph needs a concrete boundary target, and keep it outside the recurring cycle.
9. Every ordinary handoff must use the same project-specific artifact name in the source Writes and consumer Reads. A fresh consumer must not need hidden chat context.
10. The final recurring phase must interpret the domain result, update durable project state and the frontier, and produce either another justified project-specific starting handoff or a declared runtime boundary.
11. Propose the best concrete loop rather than asking the human to design it manually. Ask a focused question only when the missing choice would materially change its phases, deliverables, authority, or result contract. Explain the proposed cycle in one short project-specific sequence so the human can correct it.
12. Choose one completion policy and record it in front matter: \`confirm\` by default for product and engineering work, \`automatic\` only when declared evidence can decide safely, or \`continuous\` for open-ended work that replenishes its frontier. Challenge and acceptance are invoked by the runtime only when integration produces a completion candidate; they do not need permanent domain states.
13. Never claim hypothetical runtime evidence already exists. Record how the domain result would carry it and let a later sandbox test prove it.
14. After editing the file, respond conversationally with the concrete recurring sequence, its native deliverable and domain-named Result package, and the most important remaining uncertainty. Keep the reply concise.

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

function rehearsalPrompt() {
  return `You are the independent test supervisor for a Loopit loop.

Read .loopit/loop.md as if you were a fresh agent with no conversation history. You may inspect referenced project files when they exist, but this is a read-only rehearsal: do not modify files, run the proposed work, call external services, or claim that hypothetical evidence is real. Ignore any previous .loopit/test-report.md.

Test whether the loop's control contract can continue safely:
1. Identify the recurring domain cycle and ignore setup or runtime handlers when describing it. State and frontier -> Work contract -> Result package -> Integrated state and frontier is only the invariant you use to check the cycle; report the actual project-specific phases and artifacts.
2. Check that the proposed loop is translated into the user's domain. Fail an otherwise generic Select work -> Execute work -> Integrate result loop when the objective or repository supplies enough information to name concrete phases and handoffs. Do not force every domain into the same number of states.
3. Identify the domain's native deliverable and its domain-named Result package. Fail the loop if the result is only chat prose, if its deliverable is unclear, if it is named only Result package despite a known domain, or if a fresh consumer cannot find and inspect it.
4. Trace artifact ownership across one recurrence. Each project-specific producer must write the same named artifact its consumer reads; the domain result must reach judgment or integration; integration must update project state and replenish the frontier.
5. Test that completed, partial, failed, and blocked work all produce consumable domain results and reach integration without creating outcome-specific branch explosions.
6. Start a hypothetical fresh agent at each handoff using only declared durable artifacts. Check whether it can identify the contract, deliverable, evidence, outcome, provenance, and next responsibility without the construction conversation.
7. Evaluate setup, retries, interrupted-session recovery, human authority, budget, and completion as runtime policies separately. Do not require them to appear as ordinary domain states. Verify only that each policy has a durable resume or stop contract and cannot silently masquerade as successful work.
8. Distinguish structural proof from untested production behavior. Do not pass a claim that requires artifacts or fixtures which do not exist.
9. For completion, verify that integration creates only a candidate and the declared runtime policy performs any required challenge or human acceptance. A challenge does not need to be a permanent graph state.

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

Name exact state IDs and transition IDs. PASS means the loop is resumable and every challenged case has an explicit route. RISK means the wiring works but human input or runtime evidence is still required. FAIL means agent-resolvable control flow has a dead end, missing recurrence, or unusable transition. For RISK or FAIL, the Ownership and next action section must separate "Agent resolves now", "Ask human", and "Sandbox must prove" items, using "None" where a category is empty.`;
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
          text: `${agent === "codex" ? "Codex" : "Claude"} completed a fresh-session loop rehearsal for revision ${loop.revision}: ${verdict === "pass" ? "PASS" : "NEXT ACTION REQUIRED"}. The full Markdown report is available in the test panel.`,
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
