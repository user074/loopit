"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LoopDefinition,
  LoopState,
  LoopTransition,
  StateKind,
  TransitionKind,
} from "@/lib/loop-types";
import { validateLoop } from "@/lib/loop-validation";

const DAEMON_URL = "http://127.0.0.1:4318";
const START_CONSTRUCTION =
  "Begin first-time loop construction. No loop exists yet. Ask me one focused question about what work I want to keep progressing before proposing any states.";

type AgentName = "codex" | "claude";

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
  source?: AgentName;
}

interface SequenceLink {
  sourceId: string;
  targetId: string;
  transition: LoopTransition;
}

interface LoopBack extends SequenceLink {
  targetIndex: number;
}

interface PrimarySequence {
  states: LoopState[];
  links: SequenceLink[];
  loopBack: LoopBack | null;
  chosenTransitionIds: Set<string>;
}

const STATE_KIND_LABEL: Record<StateKind, string> = {
  observe: "Observe",
  decide: "Decide",
  act: "Act",
  evaluate: "Evaluate",
  update: "Update state",
  interrupt: "Ask human",
  terminal: "Complete",
};

const TRANSITION_KIND_LABEL: Record<TransitionKind, string> = {
  normal: "Continue",
  continue: "Loop back",
  interrupt: "Ask human",
  complete: "Complete",
};

function newMessage(
  role: ChatMessage["role"],
  text: string,
  source?: AgentName,
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    source,
  };
}

function primarySequence(loop: LoopDefinition): PrimarySequence {
  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const visited = new Map<string, number>();
  const states: LoopState[] = [];
  const links: SequenceLink[] = [];
  const chosenTransitionIds = new Set<string>();
  let loopBack: LoopBack | null = null;
  let currentId: string | undefined = loop.startState;

  while (currentId && states.length <= loop.states.length) {
    const state = stateMap.get(currentId);
    if (!state || visited.has(currentId)) break;

    visited.set(currentId, states.length);
    states.push(state);

    const transition =
      state.transitions.find((item) => item.kind === "continue") ??
      state.transitions.find((item) => item.kind === "normal");
    if (!transition) break;

    chosenTransitionIds.add(transition.id);
    const targetIndex = visited.get(transition.to);
    if (targetIndex !== undefined) {
      loopBack = {
        sourceId: state.id,
        targetId: transition.to,
        transition,
        targetIndex,
      };
      break;
    }

    links.push({
      sourceId: state.id,
      targetId: transition.to,
      transition,
    });
    currentId = transition.to;
  }

  return { states, links, loopBack, chosenTransitionIds };
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function OverviewEditor({
  loop,
  disabled,
  onCancel,
  onSave,
}: {
  loop: LoopDefinition;
  disabled: boolean;
  onCancel: () => void;
  onSave: (next: LoopDefinition) => void;
}) {
  const [name, setName] = useState(loop.name);
  const [objective, setObjective] = useState(loop.objective);

  return (
    <div className="inline-editor overview-editor">
      <label>
        Loop name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Objective
        <textarea
          rows={4}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <div className="editor-actions">
        <button className="button-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="button-primary"
          disabled={disabled || !name.trim() || !objective.trim()}
          onClick={() =>
            onSave({ ...loop, name: name.trim(), objective: objective.trim() })
          }
          type="button"
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

function StateEditor({
  state,
  states,
  disabled,
  onCancel,
  onSave,
}: {
  state: LoopState;
  states: LoopState[];
  disabled: boolean;
  onCancel: () => void;
  onSave: (state: LoopState) => void;
}) {
  const [draft, setDraft] = useState<LoopState>(() => structuredClone(state));

  const updateTransition = (
    index: number,
    update: Partial<LoopTransition>,
  ) => {
    setDraft((current) => ({
      ...current,
      transitions: current.transitions.map((transition, itemIndex) =>
        itemIndex === index ? { ...transition, ...update } : transition,
      ),
    }));
  };

  const addTransition = () => {
    const target = states.find((item) => item.id !== state.id) ?? states[0];
    if (!target) return;
    setDraft((current) => ({
      ...current,
      transitions: [
        ...current.transitions,
        {
          id: `${current.id}-to-${target.id}-${current.transitions.length + 1}`,
          to: target.id,
          when: "This step is complete",
          kind: "normal",
        },
      ],
    }));
  };

  return (
    <div className="inline-editor state-editor">
      <div className="field-grid">
        <label>
          Step name
          <input
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label>
          Step type
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                kind: event.target.value as StateKind,
              }))
            }
          >
            {Object.entries(STATE_KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Short explanation
        <input
          value={draft.summary}
          onChange={(event) =>
            setDraft((current) => ({ ...current, summary: event.target.value }))
          }
        />
      </label>
      <label>
        What happens in this step?
        <textarea
          rows={3}
          value={draft.instruction}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              instruction: event.target.value,
            }))
          }
        />
      </label>
      <label>
        How do we know it is done?
        <textarea
          rows={2}
          value={draft.completion}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              completion: event.target.value,
            }))
          }
        />
      </label>
      <div className="field-grid">
        <label>
          Reads, one per line
          <textarea
            rows={3}
            value={draft.reads.join("\n")}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                reads: splitLines(event.target.value),
              }))
            }
          />
        </label>
        <label>
          Writes, one per line
          <textarea
            rows={3}
            value={draft.writes.join("\n")}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                writes: splitLines(event.target.value),
              }))
            }
          />
        </label>
      </div>

      <div className="transition-editor">
        <div className="editor-section-heading">
          <div>
            <strong>Next paths</strong>
            <span>Where can work go after this step?</span>
          </div>
          <button className="text-button" onClick={addTransition} type="button">
            + Add path
          </button>
        </div>
        {draft.transitions.length === 0 && (
          <p className="empty-paths">No next path. This step currently stops.</p>
        )}
        {draft.transitions.map((transition, index) => (
          <div className="transition-edit-row" key={transition.id}>
            <select
              aria-label="Next state"
              value={transition.to}
              onChange={(event) =>
                updateTransition(index, { to: event.target.value })
              }
            >
              {states.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Transition condition"
              value={transition.when}
              onChange={(event) =>
                updateTransition(index, { when: event.target.value })
              }
            />
            <select
              aria-label="Transition type"
              value={transition.kind}
              onChange={(event) =>
                updateTransition(index, {
                  kind: event.target.value as TransitionKind,
                })
              }
            >
              {Object.entries(TRANSITION_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              aria-label="Remove transition"
              className="remove-button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  transitions: current.transitions.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                }))
              }
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="editor-actions">
        <button className="button-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="button-primary"
          disabled={
            disabled ||
            !draft.name.trim() ||
            !draft.summary.trim() ||
            !draft.instruction.trim() ||
            !draft.completion.trim()
          }
          onClick={() => onSave(draft)}
          type="button"
        >
          Save step
        </button>
      </div>
    </div>
  );
}

export function LoopStudio({
  initialLoop,
  initialError = null,
}: {
  initialLoop: LoopDefinition | null;
  initialError?: string | null;
}) {
  const [loop, setLoop] = useState<LoopDefinition | null>(initialLoop);
  const [health, setHealth] = useState<Health | null>(null);
  const [agent, setAgent] = useState<AgentName>("codex");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activity, setActivity] = useState("Ready");
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"overview" | string | null>(null);
  const [parseError, setParseError] = useState<string | null>(initialError);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sequence = useMemo(
    () => (loop ? primarySequence(loop) : null),
    [loop],
  );
  const findings = useMemo(() => (loop ? validateLoop(loop) : []), [loop]);
  const blockingFindings = findings.filter((item) => item.severity === "error");

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
        const payload = (await loopResponse.json()) as {
          loop: LoopDefinition | null;
        };
        setLoop(payload.loop);
        setParseError(null);
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

  const sendMessage = async (textOverride?: string, displayText?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || isWorking) return;

    const selectedAgent = health?.agents[agent];
    if (selectedAgent && !selectedAgent.installed) {
      setMessages((current) => [
        ...current,
        newMessage("error", `${agent} is not installed on this machine.`),
      ]);
      return;
    }

    setMessages((current) => [
      ...current,
      newMessage("user", displayText ?? text),
    ]);
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
          selectedElementId: selectedStateId,
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
              newMessage("agent", event.text, agent),
            ]);
          }
          if (event.type === "error") {
            setMessages((current) => [
              ...current,
              newMessage("error", event.text),
            ]);
            if (String(event.text).includes("Markdown could not be parsed")) {
              setParseError(event.text);
            }
          }
          if (event.type === "loop_updated") {
            setLoop(event.loop as LoopDefinition);
            setParseError(null);
          }
          if (event.type === "done") {
            setActivity(event.interrupted ? "Agent stopped" : "Ready");
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

  const persistLoop = async (
    nextLoop: LoopDefinition,
    note: string,
  ): Promise<LoopDefinition | null> => {
    if (isSaving || isWorking) return null;
    setIsSaving(true);
    try {
      const response = await fetch(`${DAEMON_URL}/api/loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loop: nextLoop }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The loop was not saved.");
      const saved = payload.loop as LoopDefinition;
      setLoop(saved);
      setEditing(null);
      setMessages((current) => [
        ...current,
        newMessage(
          "loopit",
          `${note} Saved to loop.md; the agent will read revision ${saved.revision} on the next turn.`,
        ),
      ]);
      return saved;
    } catch (error) {
      setMessages((current) => [
        ...current,
        newMessage(
          "error",
          error instanceof Error ? error.message : "The visual edit failed.",
        ),
      ]);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const saveState = async (state: LoopState) => {
    if (!loop) return;
    await persistLoop(
      {
        ...loop,
        states: loop.states.map((item) => (item.id === state.id ? state : item)),
      },
      `Updated “${state.name}”.`,
    );
  };

  const addStepBeforeRepeat = async () => {
    if (!loop || !sequence) return;
    const existing = new Set(loop.states.map((state) => state.id));
    let index = loop.states.length + 1;
    let id = `step-${index}`;
    while (existing.has(id)) id = `step-${(index += 1)}`;

    const newState: LoopState = {
      id,
      name: "New step",
      kind: "act",
      summary: "Describe what happens before the loop repeats.",
      reads: [],
      instruction: "Describe the bounded work performed in this step.",
      writes: [],
      completion: "Describe the evidence that makes this step complete.",
      transitions: [],
    };

    let states = [...loop.states, newState];
    if (sequence.loopBack) {
      const { sourceId, targetId, transition } = sequence.loopBack;
      states = states.map((state) =>
        state.id === sourceId
          ? {
              ...state,
              transitions: state.transitions.map((item) =>
                item.id === transition.id
                  ? { ...item, to: id, kind: "normal" }
                  : item,
              ),
            }
          : state,
      );
      newState.transitions = [
        {
          id: `${id}-to-${targetId}`,
          to: targetId,
          when: "This step is complete",
          kind: transition.kind === "continue" ? "continue" : "normal",
        },
      ];
    }

    const saved = await persistLoop(
      { ...loop, states },
      "Added a new step before the loop repeats.",
    );
    if (saved) {
      setSelectedStateId(id);
      setEditing(id);
    }
  };

  const interrupt = async () => {
    await fetch(`${DAEMON_URL}/api/interrupt`, { method: "POST" }).catch(
      () => undefined,
    );
    setActivity("Stopping agent");
  };

  const otherTransitions =
    loop && sequence
      ? loop.states.flatMap((state) =>
          state.transitions
            .filter((transition) => !sequence.chosenTransitionIds.has(transition.id))
            .map((transition) => ({ state, transition })),
        )
      : [];
  const sequenceIds = new Set(sequence?.states.map((state) => state.id) ?? []);
  const otherStates = loop?.states.filter((state) => !sequenceIds.has(state.id)) ?? [];

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">↺</span>
          <div>
            <strong>Loopit</strong>
            <span>Construct a continuing loop</span>
          </div>
        </div>
        <div className="connection-status">
          <span className={health?.ok ? "status-dot is-online" : "status-dot"} />
          {health?.ok ? "Local project connected" : "Connecting…"}
        </div>
      </header>

      <div className="studio-grid">
        <aside className="chat-panel" aria-label="Loop construction chat">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Conversation</span>
              <h1>Build with your agent</h1>
            </div>
            <div className="agent-switcher" aria-label="Choose local agent">
              {(["codex", "claude"] as AgentName[]).map((name) => (
                <button
                  className={agent === name ? "is-active" : ""}
                  disabled={health ? !health.agents[name].installed : false}
                  key={name}
                  onClick={() => setAgent(name)}
                  title={health?.agents[name].version ?? `${name} is not installed`}
                  type="button"
                >
                  {name === "codex" ? "Codex" : "Claude"}
                </button>
              ))}
            </div>
          </div>

          <div className="chat-messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="chat-empty">
                <strong>Start with the work, not the workflow.</strong>
                <p>
                  Describe what you want to keep progressing, or use the button on
                  the right. Your agent will ask one focused question at a time.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <article className={`chat-message is-${message.role}`} key={message.id}>
                <span>
                  {message.role === "user"
                    ? "You"
                    : message.role === "agent"
                      ? message.source === "claude"
                        ? "Claude"
                        : "Codex"
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

          <div className="composer">
            {selectedStateId && loop && (
              <div className="composer-context">
                Discussing: {loop.states.find((state) => state.id === selectedStateId)?.name}
                <button onClick={() => setSelectedStateId(null)} type="button">×</button>
              </div>
            )}
            <textarea
              aria-label="Message the loop construction agent"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={
                loop
                  ? "Ask about the loop, or describe a change…"
                  : "What work do you want to keep moving?"
              }
              rows={3}
              value={input}
            />
            <div className="composer-footer">
              <span>Enter to send · Shift-Enter for a new line</span>
              {isWorking ? (
                <button className="button-stop" onClick={interrupt} type="button">
                  Stop agent
                </button>
              ) : (
                <button
                  className="button-primary"
                  disabled={!input.trim()}
                  onClick={() => void sendMessage()}
                  type="button"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </aside>

        <section className="loop-panel" aria-label="Loop editor">
          {!loop && !parseError && (
            <div className="empty-loop">
              <div className="empty-loop-mark" aria-hidden="true">
                <span>1</span><i>→</i><span>2</span><i>↺</i>
              </div>
              <span className="eyebrow">Your loop</span>
              <h2>No loop yet</h2>
              <p>
                First, tell the agent what you want to keep progressing. It will
                ask questions and propose the smallest loop that can continue.
              </p>
              <button
                className="button-primary button-large"
                disabled={isWorking}
                onClick={() =>
                  void sendMessage(START_CONSTRUCTION, "Construct my first loop")
                }
                type="button"
              >
                Construct my first loop
              </button>
              <small>Nothing is created until the objective is clear.</small>
            </div>
          )}

          {!loop && parseError && (
            <div className="empty-loop error-state">
              <span className="eyebrow">loop.md needs repair</span>
              <h2>The current loop cannot be read</h2>
              <p>{parseError}</p>
              <button
                className="button-primary"
                onClick={() =>
                  void sendMessage(
                    "Repair the existing loop.md so it follows the required Markdown contract. Preserve the user's intent and make the smallest possible correction.",
                    "Ask the agent to repair loop.md",
                  )
                }
                type="button"
              >
                Ask agent to repair it
              </button>
            </div>
          )}

          {loop && sequence && (
            <div className="loop-content">
              <div className="loop-overview">
                <div className="loop-overview-heading">
                  <div>
                    <span className="eyebrow">Your loop · revision {loop.revision}</span>
                    <h2>{loop.name}</h2>
                  </div>
                  <button
                    className="button-secondary"
                    onClick={() => setEditing("overview")}
                    type="button"
                  >
                    Edit objective
                  </button>
                </div>
                {editing === "overview" ? (
                  <OverviewEditor
                    disabled={isSaving}
                    loop={loop}
                    onCancel={() => setEditing(null)}
                    onSave={(next) => void persistLoop(next, "Updated the loop objective.")}
                  />
                ) : (
                  <p className="objective-copy">{loop.objective}</p>
                )}
                <div className={`simple-health ${blockingFindings.length ? "has-errors" : "is-good"}`}>
                  <strong>
                    {blockingFindings.length
                      ? `${blockingFindings.length} structural ${blockingFindings.length === 1 ? "issue" : "issues"}`
                      : "The loop can repeat"}
                  </strong>
                  <span>
                    {blockingFindings.length
                      ? "Open checks below or ask the agent to repair them."
                      : "A path returns to earlier work after state is updated."}
                  </span>
                </div>
              </div>

              <section className="sequence-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">The continuing path</span>
                    <h3>What happens, one step at a time</h3>
                  </div>
                  <span>{sequence.states.length} steps</span>
                </div>

                <ol className="step-sequence">
                  {sequence.states.map((state, index) => {
                    const link = sequence.links.find((item) => item.sourceId === state.id);
                    const isCycleStart = sequence.loopBack?.targetId === state.id;
                    return (
                      <li key={state.id}>
                        <article className={`step-card ${isCycleStart ? "is-cycle-start" : ""}`}>
                          {editing === state.id ? (
                            <StateEditor
                              disabled={isSaving}
                              onCancel={() => setEditing(null)}
                              onSave={(next) => void saveState(next)}
                              state={state}
                              states={loop.states}
                            />
                          ) : (
                            <>
                              <div className="step-number">{index + 1}</div>
                              <div className="step-copy">
                                <div className="step-meta">
                                  <span>{STATE_KIND_LABEL[state.kind]}</span>
                                  {isCycleStart && <strong>Loop begins here</strong>}
                                </div>
                                <h4>{state.name}</h4>
                                <p>{state.summary}</p>
                                <div className="done-when">
                                  <span>Done when</span>
                                  {state.completion}
                                </div>
                              </div>
                              <button
                                className="edit-step-button"
                                onClick={() => {
                                  setSelectedStateId(state.id);
                                  setEditing(state.id);
                                }}
                                type="button"
                              >
                                Edit
                              </button>
                            </>
                          )}
                        </article>
                        {link && (
                          <div className="step-connector">
                            <span aria-hidden="true">↓</span>
                            <p>{link.transition.when}</p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>

                {sequence.loopBack ? (
                  <div className="loop-back">
                    <span aria-hidden="true">↺</span>
                    <div>
                      <strong>
                        Then return to step {sequence.loopBack.targetIndex + 1}: {loop.states.find((state) => state.id === sequence.loopBack?.targetId)?.name}
                      </strong>
                      <p>{sequence.loopBack.transition.when}</p>
                    </div>
                  </div>
                ) : (
                  <div className="missing-loop-back">
                    <strong>This path does not loop back yet.</strong>
                    <button
                      className="text-button"
                      onClick={() =>
                        void sendMessage(
                          "The visual editor shows no continuation path back into the loop. Propose the smallest valid loop-back transition.",
                          "Help me close the loop",
                        )
                      }
                      type="button"
                    >
                      Ask agent to close it
                    </button>
                  </div>
                )}

                {sequence.loopBack && (
                  <button
                    className="add-step-button"
                    disabled={isSaving || isWorking}
                    onClick={() => void addStepBeforeRepeat()}
                    type="button"
                  >
                    + Add a step before the loop repeats
                  </button>
                )}
              </section>

              {(otherTransitions.length > 0 || otherStates.length > 0) && (
                <details className="secondary-paths">
                  <summary>
                    Stops, alternate paths, and other steps
                    <span>{otherTransitions.length + otherStates.length}</span>
                  </summary>
                  <div className="secondary-list">
                    {otherTransitions.map(({ state, transition }) => (
                      <button
                        key={transition.id}
                        onClick={() => {
                          setSelectedStateId(state.id);
                          setEditing(state.id);
                        }}
                        type="button"
                      >
                        <span>{TRANSITION_KIND_LABEL[transition.kind]}</span>
                        <strong>{state.name}</strong>
                        <p>{transition.when}</p>
                      </button>
                    ))}
                    {otherStates.map((state) => (
                      <button
                        key={state.id}
                        onClick={() => {
                          setSelectedStateId(state.id);
                          setEditing(state.id);
                        }}
                        type="button"
                      >
                        <span>Other step</span>
                        <strong>{state.name}</strong>
                        <p>{state.summary}</p>
                      </button>
                    ))}
                  </div>
                </details>
              )}

              {findings.length > 0 && (
                <details className="validation-details">
                  <summary>Structural checks <span>{findings.length}</span></summary>
                  <div>
                    {findings.map((finding) => (
                      <button
                        className={`validation-row is-${finding.severity}`}
                        key={finding.id}
                        onClick={() => {
                          if (finding.elementId) {
                            setSelectedStateId(finding.elementId);
                            setEditing(finding.elementId);
                          }
                        }}
                        type="button"
                      >
                        <span>{finding.severity === "pass" ? "✓" : "!"}</span>
                        <div>
                          <strong>{finding.title}</strong>
                          <p>{finding.detail}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
