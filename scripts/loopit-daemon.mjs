import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseLoopMarkdown,
  serializeLoopMarkdown,
} from "../lib/loop-markdown.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.env.LOOPIT_PROJECT || process.cwd());
const loopitDir = path.join(projectRoot, ".loopit");
const loopPath = path.join(loopitDir, "loop.md");
const sessionPath = path.join(loopitDir, "session.json");
const port = Number(process.env.LOOPIT_DAEMON_PORT || 4318);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

let activeRun = null;

await mkdir(loopitDir, { recursive: true });

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
- YAML front matter with loopit, revision, status, and start.
- One H1 loop name and an H2 Objective.
- H2 Artifacts and Boundaries, with H3 entries and bold ID, Kind, and Description fields.
- H2 States, with one H3 per state and bold ID, Kind, and Summary fields.
- Each state keeps H4 Reads, Instruction, Writes, Completion, and Transitions sections.
- Reads and Writes are Markdown lists.
- Transitions use the existing four-column Markdown table: Next state, When, Kind, and ID.
- Allowed state kinds: observe, decide, act, evaluate, update, interrupt, terminal.
- Allowed transition kinds: normal, continue, interrupt, complete.
- Increment revision after a meaningful change.

Construction principles:
1. Keep the loop as small as possible.
2. Every state must make its inputs, work, outputs, completion evidence, and next paths inspectable.
3. Every nonterminal state needs an outgoing transition.
4. A continuing cycle must evaluate evidence and update durable state before returning to more work.
5. Human interrupts and completion must be explicit.
6. Ask focused questions only when the missing choice would materially change the loop. Otherwise propose the best draft.
7. After editing the file, respond conversationally with what changed, why, and the most important remaining uncertainty. Keep the reply concise.

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

  const sessions = await readJson(sessionPath, {});
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
      }
      if (event.type === "turn.failed") {
        providerErrorSent = true;
        send({ type: "error", text: readableProviderError(event, agent) });
      }
      if (event.type === "error") {
        providerErrorSent = true;
        send({ type: "error", text: readableProviderError(event, agent) });
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
      }
      if (event.is_error) {
        providerErrorSent = true;
        send({ type: "error", text: readableProviderError(event, agent) });
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
    send({
      type: "error",
      text: `${invocation.command} could not be started: ${error.message}`,
    });
  });

  child.on("close", async (code, signal) => {
    activeRun = null;

    if (discoveredSessionId) {
      sessions[agent] = {
        sessionId: discoveredSessionId,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(sessionPath, sessions);
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
    }

    try {
      const loop = await readLoopOrNull();
      if (loop) send({ type: "loop_updated", loop });
    } catch (error) {
      send({
        type: "error",
        text: `The loop Markdown could not be parsed: ${error instanceof Error ? error.message : "Unknown parsing error."}`,
      });
    }
    if (!finalMessageSent && code === 0) {
      send({
        type: "agent_message",
        text: "The loop proposal was updated. Inspect the changed states and validation findings on the right.",
      });
    }
    send({ type: "done", interrupted: signal === "SIGTERM" });
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
