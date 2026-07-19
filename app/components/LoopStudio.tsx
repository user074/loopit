"use client";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LoopDefinition,
  LoopState,
  LoopTransition,
  StateKind,
  ValidationFinding,
} from "@/lib/loop-types";
import { validateLoop } from "@/lib/loop-validation";

const DAEMON_URL = "http://127.0.0.1:4318";

type AgentName = "codex" | "claude";
type SelectedElement =
  | { type: "state"; id: string }
  | { type: "transition"; id: string };

interface AgentHealth {
  installed: boolean;
  version: string | null;
}

interface Health {
  ok: boolean;
  projectRoot: string;
  active: boolean;
  agents: Record<AgentName, AgentHealth>;
}

interface ChatMessage {
  id: string;
  role: "loopit" | "user" | "agent" | "error";
  text: string;
}

const KIND_LABEL: Record<StateKind, string> = {
  observe: "Observe",
  decide: "Decide",
  act: "Act",
  evaluate: "Evaluate",
  update: "Update",
  interrupt: "Interrupt",
  terminal: "Complete",
};

const EDGE_COLOR = {
  normal: "#82908a",
  continue: "#2f8f62",
  interrupt: "#c88736",
  complete: "#6e7180",
};

function newMessage(
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
  };
}

function shortCondition(text: string) {
  return text.length > 42 ? `${text.slice(0, 39)}…` : text;
}

function layoutStates(loop: LoopDefinition) {
  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const depth = new Map<string, number>();
  const queue = stateMap.has(loop.startState)
    ? [{ id: loop.startState, depth: 0 }]
    : [];

  while (queue.length) {
    const item = queue.shift()!;
    if (depth.has(item.id)) continue;
    depth.set(item.id, item.depth);
    const state = stateMap.get(item.id);
    state?.transitions.forEach((transition) => {
      if (!depth.has(transition.to) && transition.kind !== "continue") {
        queue.push({ id: transition.to, depth: item.depth + 1 });
      }
    });
  }

  let fallbackDepth = Math.max(0, ...depth.values()) + 1;
  loop.states.forEach((state) => {
    if (!depth.has(state.id)) depth.set(state.id, fallbackDepth++);
  });

  const groups = new Map<number, LoopState[]>();
  loop.states.forEach((state) => {
    const level = depth.get(state.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), state]);
  });

  const nodes: Node[] = [];
  for (const [level, states] of [...groups.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    states.forEach((state, index) => {
      nodes.push({
        id: state.id,
        position: {
          x: level * 290,
          y: index * 174 - ((states.length - 1) * 174) / 2,
        },
        className: `loop-node loop-node--${state.kind}`,
        data: {
          label: (
            <div className="node-card">
              <div className="node-card__meta">
                <span>{KIND_LABEL[state.kind]}</span>
                {state.id === loop.startState && <strong>Start</strong>}
              </div>
              <h3>{state.name}</h3>
              <p>{state.summary}</p>
              <div className="node-card__io">
                <span>{state.reads.length} in</span>
                <span>{state.writes.length} out</span>
              </div>
            </div>
          ),
        },
      });
    });
  }

  const edges: Edge[] = loop.states.flatMap((state) =>
    state.transitions.map((transition) => ({
      id: transition.id,
      source: state.id,
      target: transition.to,
      label: shortCondition(transition.when),
      type: "smoothstep",
      animated: transition.kind === "continue",
      className: `loop-edge loop-edge--${transition.kind}`,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLOR[transition.kind],
      },
      style: {
        stroke: EDGE_COLOR[transition.kind],
        strokeWidth: transition.kind === "continue" ? 2.8 : 1.8,
        strokeDasharray: transition.kind === "interrupt" ? "6 5" : undefined,
      },
      labelStyle: {
        fill: "#56625e",
        fontSize: 10,
        fontWeight: 600,
      },
      labelBgStyle: {
        fill: "#f7f6f1",
        fillOpacity: 0.92,
      },
      data: { transition, sourceName: state.name },
    })),
  );

  return { nodes, edges };
}

function selectionDetails(
  loop: LoopDefinition,
  selection: SelectedElement,
) {
  if (selection.type === "state") {
    return {
      state: loop.states.find((state) => state.id === selection.id) ?? null,
      transition: null,
      source: null,
      target: null,
    };
  }

  for (const state of loop.states) {
    const transition = state.transitions.find(
      (item) => item.id === selection.id,
    );
    if (transition) {
      return {
        state: null,
        transition,
        source: state,
        target:
          loop.states.find((candidate) => candidate.id === transition.to) ??
          null,
      };
    }
  }

  return { state: null, transition: null, source: null, target: null };
}

function FindingIcon({ severity }: Pick<ValidationFinding, "severity">) {
  return (
    <span className={`finding-icon finding-icon--${severity}`} aria-hidden="true">
      {severity === "pass" ? "✓" : severity === "warning" ? "!" : "×"}
    </span>
  );
}

export function LoopStudio({ initialLoop }: { initialLoop: LoopDefinition }) {
  const [loop, setLoop] = useState(initialLoop);
  const [health, setHealth] = useState<Health | null>(null);
  const [agent, setAgent] = useState<AgentName>("codex");
  const [selection, setSelection] = useState<SelectedElement>({
    type: "state",
    id: initialLoop.startState,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    newMessage(
      "loopit",
      "The current draft is parsed from .loopit/loop.md. Select any state or relation, then ask your local agent to explain, simplify, or repair it.",
    ),
  ]);
  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [activity, setActivity] = useState("Ready to construct");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const findings = useMemo(() => validateLoop(loop), [loop]);
  const blockingCount = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warningCount = findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  const graph = useMemo(() => layoutStates(loop), [loop]);
  const details = useMemo(
    () => selectionDetails(loop, selection),
    [loop, selection],
  );

  const refresh = useCallback(async () => {
    try {
      const [healthResponse, loopResponse] = await Promise.all([
        fetch(`${DAEMON_URL}/api/health`),
        fetch(`${DAEMON_URL}/api/loop`),
      ]);
      if (healthResponse.ok) {
        const nextHealth = (await healthResponse.json()) as Health;
        setHealth(nextHealth);
        if (!nextHealth.agents.codex.installed && nextHealth.agents.claude.installed) {
          setAgent("claude");
        }
      }
      if (loopResponse.ok) {
        const payload = (await loopResponse.json()) as { loop: LoopDefinition };
        setLoop(payload.loop);
      }
    } catch {
      setActivity("Local bridge is offline");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activity]);

  useEffect(() => {
    const elementExists =
      selection.type === "state"
        ? loop.states.some((state) => state.id === selection.id)
        : loop.states.some((state) =>
            state.transitions.some(
              (transition) => transition.id === selection.id,
            ),
          );
    if (!elementExists) {
      setSelection({ type: "state", id: loop.startState });
    }
  }, [loop, selection]);

  const selectFinding = (finding: ValidationFinding) => {
    if (finding.elementId) {
      setSelection({ type: "state", id: finding.elementId });
    }
  };

  const askAboutFinding = (finding: ValidationFinding) => {
    selectFinding(finding);
    setInput(
      `Fix this validation finding with the smallest possible change: ${finding.title}. ${finding.detail}`,
    );
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isWorking) return;

    const selectedAgent = health?.agents[agent];
    if (selectedAgent && !selectedAgent.installed) {
      setMessages((current) => [
        ...current,
        newMessage("error", `${agent} is not installed on this machine.`),
      ]);
      return;
    }

    setMessages((current) => [...current, newMessage("user", text)]);
    setInput("");
    setIsWorking(true);
    setActivity(`Starting ${agent === "codex" ? "Codex" : "Claude"}`);

    try {
      const response = await fetch(`${DAEMON_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          message: text,
          selectedElementId: selection.id,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "The construction agent did not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const packets = buffer.split("\n\n");
        buffer = packets.pop() ?? "";

        for (const packet of packets) {
          const dataLine = packet
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6));

          if (event.type === "status" || event.type === "activity") {
            setActivity(event.text);
          }
          if (event.type === "agent_message") {
            setMessages((current) => [
              ...current,
              newMessage("agent", event.text),
            ]);
          }
          if (event.type === "error") {
            setMessages((current) => [
              ...current,
              newMessage("error", event.text),
            ]);
          }
          if (event.type === "loop_updated") {
            setLoop(event.loop as LoopDefinition);
          }
          if (event.type === "done") {
            setActivity(event.interrupted ? "Agent stopped" : "Draft updated");
          }
        }
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        newMessage(
          "error",
          error instanceof Error ? error.message : "The local agent failed.",
        ),
      ]);
      setActivity("Local agent unavailable");
    } finally {
      setIsWorking(false);
      void refresh();
    }
  };

  const interrupt = async () => {
    await fetch(`${DAEMON_URL}/api/interrupt`, { method: "POST" }).catch(
      () => undefined,
    );
    setActivity("Stopping agent");
  };

  const onComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <strong>Loopit</strong>
            <span>Construction studio</span>
          </div>
        </div>
        <div className="project-context">
          <span className={`bridge-dot ${health?.ok ? "is-online" : ""}`} />
          <span>{health?.projectRoot ?? "Connecting to local project…"}</span>
        </div>
        <div className="draft-meta">
          <span className="draft-pill">Draft v{loop.revision}</span>
          <span className={blockingCount ? "health-bad" : "health-good"}>
            {blockingCount
              ? `${blockingCount} blocking`
              : warningCount
                ? `${warningCount} to review`
                : "Structurally viable"}
          </span>
        </div>
      </header>

      <section className="studio-grid">
        <aside className="chat-panel" aria-label="Loop construction chat">
          <div className="chat-heading">
            <div>
              <span className="eyebrow">Local supervisor</span>
              <h1>Construct the loop with an agent</h1>
            </div>
            <div className="agent-switcher" aria-label="Choose local agent">
              {(["codex", "claude"] as AgentName[]).map((name) => (
                <button
                  key={name}
                  className={agent === name ? "is-active" : ""}
                  disabled={health ? !health.agents[name].installed : false}
                  onClick={() => setAgent(name)}
                  title={
                    health?.agents[name].version ?? `${name} is not installed`
                  }
                  type="button"
                >
                  {name === "codex" ? "Codex" : "Claude"}
                </button>
              ))}
            </div>
          </div>

          <div className="chat-messages" aria-live="polite">
            {messages.map((message) => (
              <article
                className={`chat-message chat-message--${message.role}`}
                key={message.id}
              >
                <span className="chat-message__label">
                  {message.role === "user"
                    ? "You"
                    : message.role === "agent"
                      ? agent === "codex"
                        ? "Codex"
                        : "Claude"
                      : message.role === "error"
                        ? "Problem"
                        : "Loopit"}
                </span>
                <p>{message.text}</p>
              </article>
            ))}
            {isWorking && (
              <div className="agent-activity">
                <span className="pulse-dot" />
                {activity}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="prompt-suggestions" aria-label="Suggested prompts">
            {["Find a dead end", "Simplify this loop", "Explain the loop-back"].map(
              (suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setInput(suggestion)}
                >
                  {suggestion}
                </button>
              ),
            )}
          </div>

          <div className="composer">
            <div className="composer-context">
              <span>Context</span>
              <strong>
                {details.state?.name ??
                  (details.transition
                    ? `${details.source?.name} → ${details.target?.name}`
                    : "Whole loop")}
              </strong>
            </div>
            <textarea
              aria-label="Message the loop construction agent"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask the agent to explain, repair, or change this loop…"
              rows={3}
              value={input}
            />
            <div className="composer-actions">
              <span>Enter to send · Shift Enter for newline</span>
              {isWorking ? (
                <button className="stop-button" onClick={interrupt} type="button">
                  Stop
                </button>
              ) : (
                <button
                  className="send-button"
                  disabled={!input.trim()}
                  onClick={() => void sendMessage()}
                  type="button"
                >
                  Send
                  <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          </div>
        </aside>

        <section className="loop-panel" aria-label="Proposed loop visualization">
          <div className="loop-heading">
            <div>
              <span className="eyebrow">Proposed loop</span>
              <h2>{loop.name}</h2>
              <p>{loop.objective}</p>
            </div>
            <div className="legend" aria-label="Transition legend">
              <span><i className="legend-line legend-line--normal" />Move</span>
              <span><i className="legend-line legend-line--continue" />Continue</span>
              <span><i className="legend-line legend-line--interrupt" />Interrupt</span>
            </div>
          </div>

          <div className="loop-canvas" data-testid="loop-canvas">
            <ReactFlow
              edges={graph.edges}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              maxZoom={1.45}
              minZoom={0.34}
              nodes={graph.nodes}
              nodesConnectable={false}
              nodesDraggable={false}
              onEdgeClick={(_, edge) =>
                setSelection({ type: "transition", id: edge.id })
              }
              onNodeClick={(_, node) =>
                setSelection({ type: "state", id: node.id })
              }
              panOnScroll
              proOptions={{ hideAttribution: false }}
            >
              <Background color="#d9d8d1" gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <div className="inspection-grid">
            <section className="contract-panel" aria-label="Selected contract">
              {details.state && (
                <StateContract
                  state={details.state}
                  onSelectTransition={(id) =>
                    setSelection({ type: "transition", id })
                  }
                />
              )}
              {details.transition && details.source && details.target && (
                <TransitionContract
                  source={details.source}
                  target={details.target}
                  transition={details.transition}
                />
              )}
            </section>

            <section className="validation-panel" aria-label="Loop validation">
              <div className="section-title-row">
                <div>
                  <span className="eyebrow">Deterministic checks</span>
                  <h3>Loop validation</h3>
                </div>
                <span className="validation-count">
                  {findings.filter((finding) => finding.severity === "pass").length}/
                  {findings.length} passed
                </span>
              </div>
              <div className="finding-list">
                {findings.map((finding) => (
                  <div
                    className={`finding finding--${finding.severity}`}
                    key={finding.id}
                  >
                    <button
                      className="finding-summary"
                      onClick={() => selectFinding(finding)}
                      type="button"
                    >
                      <FindingIcon severity={finding.severity} />
                      <span>
                        <strong>{finding.title}</strong>
                        <small>{finding.detail}</small>
                      </span>
                    </button>
                    {finding.severity !== "pass" && (
                      <button
                        className="finding-action"
                        onClick={() => askAboutFinding(finding)}
                        type="button"
                      >
                        Ask agent
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function StateContract({
  state,
  onSelectTransition,
}: {
  state: LoopState;
  onSelectTransition: (id: string) => void;
}) {
  return (
    <>
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Selected state · {KIND_LABEL[state.kind]}</span>
          <h3>{state.name}</h3>
        </div>
        <span className={`state-kind state-kind--${state.kind}`}>
          {KIND_LABEL[state.kind]}
        </span>
      </div>
      <p className="contract-instruction">{state.instruction}</p>
      <div className="contract-columns">
        <ContractList label="Reads" items={state.reads} />
        <ContractList label="Writes" items={state.writes} />
      </div>
      <div className="completion-card">
        <span>Completion evidence</span>
        <p>{state.completion}</p>
      </div>
      {state.transitions.length > 0 && (
        <div className="transition-list">
          <span>Next relations</span>
          {state.transitions.map((transition) => (
            <button
              key={transition.id}
              onClick={() => onSelectTransition(transition.id)}
              type="button"
            >
              <i className={`transition-dot transition-dot--${transition.kind}`} />
              <span>{transition.when}</span>
              <strong aria-hidden="true">→</strong>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function TransitionContract({
  source,
  target,
  transition,
}: {
  source: LoopState;
  target: LoopState;
  transition: LoopTransition;
}) {
  return (
    <>
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Selected relation</span>
          <h3>{source.name} → {target.name}</h3>
        </div>
        <span className={`relation-kind relation-kind--${transition.kind}`}>
          {transition.kind}
        </span>
      </div>
      <div className="relation-route">
        <span>{source.name}</span>
        <i aria-hidden="true">→</i>
        <span>{target.name}</span>
      </div>
      <div className="completion-card">
        <span>Transition condition</span>
        <p>{transition.when}</p>
      </div>
      <p className="relation-help">
        Ask the agent what evidence proves this condition, or whether this path
        can stop the loop prematurely.
      </p>
    </>
  );
}

function ContractList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="contract-list">
      <span>{label}</span>
      <div>
        {items.length ? (
          items.map((item) => <em key={item}>{item}</em>)
        ) : (
          <em className="is-empty">Nothing declared</em>
        )}
      </div>
    </div>
  );
}
