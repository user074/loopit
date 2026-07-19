"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CompletionPolicy,
  LoopDefinition,
  LoopState,
  LoopTransition,
  StateKind,
  TransitionKind,
} from "@/lib/loop-types";
import { primarySequence, stateHandoff } from "@/lib/loop-flow";
import type { PrimarySequence } from "@/lib/loop-flow";
import { validateLoop } from "@/lib/loop-validation";

const DAEMON_URL = "http://127.0.0.1:4318";
const START_CONSTRUCTION =
  "Begin first-time loop construction. No loop exists yet. Ask me one focused question about what work I want to keep progressing before proposing any states.";
const RESOLVE_TEST_FAILURE = `The latest .loopit/test-report.md found unresolved preflight issues. Treat this result as the next construction action, never as a reason to stop.

Read both .loopit/loop.md and .loopit/test-report.md. Classify every issue by ownership:
- Agent-owned: missing domain handoff, unclear native deliverable, incomplete Result package, inconsistent artifact ownership, or state integration logic that an agent can define safely. Resolve these now by making the smallest coherent update to loop.md.
- Human-owned: product intent, acceptance threshold, permission, credential, sensitive fact, risk choice, or policy that the agent must not invent. After resolving agent-owned issues, ask exactly one focused question for the highest-leverage missing human input.
- Runtime evidence: behavior that only a later sandbox execution can prove. Define how the Result package will carry the observed evidence; do not claim it already passed.

Keep setup, retry, interrupted-session recovery, human interruption, and completion acceptance in runtime policy rather than duplicating them as outgoing states from every domain step. Explain the next action concisely.`;

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

interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: string | null;
  messageCount: number;
  active: boolean;
}

interface ConversationPayload {
  activeConversationId: string;
  messages: ChatMessage[];
  conversations: ConversationSummary[];
}

interface AgentTestResult {
  verdict: "pass" | "risk" | "fail";
  agent: AgentName;
  loopRevision: number | null;
  testedAt: string | null;
  report: string;
}

interface WiringTestStep {
  sourceId: string;
  targetId: string;
  transition: LoopTransition;
  lane: "usual" | "repeat" | "edge";
}

type WiringTestStatus = "idle" | "running" | "passed" | "failed";
type TestResolutionStatus = "idle" | "working" | "finished";
type FlowZoom = 0 | 1 | 2;

const FLOW_ZOOM_LABEL: Record<FlowZoom, string> = {
  0: "Loop",
  1: "Handoffs",
  2: "Details",
};

const FLOW_ZOOM_DESCRIPTION: Record<FlowZoom, string> = {
  0: "Project stages only",
  1: "Stage summaries and named handoffs",
  2: "Full instructions, evidence, and exit rules",
};

const STATE_KIND_LABEL: Record<StateKind, string> = {
  observe: "Observe",
  decide: "Decide",
  act: "Act",
  evaluate: "Evaluate",
  challenge: "Challenge completion",
  update: "Update state",
  interrupt: "Ask human",
  terminal: "Accepted outcome",
};

const TRANSITION_KIND_LABEL: Record<TransitionKind, string> = {
  normal: "Continue",
  continue: "Loop back",
  interrupt: "Ask human",
  complete: "Accept outcome",
};

const COMPLETION_POLICY_LABEL: Record<CompletionPolicy, string> = {
  confirm: "Human confirms candidate",
  automatic: "Evidence can auto-accept",
  continuous: "Continuous until interrupted",
};

const COMPLETION_POLICY_DESCRIPTION: Record<CompletionPolicy, string> = {
  confirm:
    "A fresh agent challenges the candidate, then a human accepts it or adds another thought.",
  automatic:
    "A fresh agent may accept only when declared evidence passes and no blocking gap remains.",
  continuous:
    "New findings return to the frontier; only a human, budget, or explicit boundary pauses the loop.",
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

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function handoffSummary(items: string[]) {
  if (!items.length) return "No named artifact handoff";
  const productArtifacts = items.filter(
    (item) => !/checkpoint|recovery record|run cursor/i.test(item),
  );
  const visible = productArtifacts.length ? productArtifacts : items;
  if (visible.length <= 2) return visible.join(" + ");
  return `${visible.slice(0, 2).join(" + ")} +${visible.length - 2}`;
}

function conversationTime(conversation: ConversationSummary) {
  if (conversation.active) return "Current";
  if (!conversation.updatedAt) return "Empty";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(conversation.updatedAt));
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
  const [completionPolicy, setCompletionPolicy] =
    useState<CompletionPolicy>(loop.completionPolicy);

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
      <label>
        Completion policy
        <select
          value={completionPolicy}
          onChange={(event) =>
            setCompletionPolicy(event.target.value as CompletionPolicy)
          }
        >
          {Object.entries(COMPLETION_POLICY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <small>{COMPLETION_POLICY_DESCRIPTION[completionPolicy]}</small>
      </label>
      <div className="editor-actions">
        <button className="button-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="button-primary"
          disabled={disabled || !name.trim() || !objective.trim()}
          onClick={() =>
            onSave({
              ...loop,
              name: name.trim(),
              objective: objective.trim(),
              completionPolicy,
            })
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

function StateFlowCanvas({
  loop,
  sequence,
  zoom,
  focusedStateId,
  editing,
  disabled,
  currentWiringStep,
  onZoomChange,
  onFocus,
  onEdit,
  onDiscuss,
  onSave,
  onCancelEdit,
  onAddStep,
}: {
  loop: LoopDefinition;
  sequence: PrimarySequence;
  zoom: FlowZoom;
  focusedStateId: string | null;
  editing: "overview" | string | null;
  disabled: boolean;
  currentWiringStep: WiringTestStep | null;
  onZoomChange: (zoom: FlowZoom) => void;
  onFocus: (stateId: string) => void;
  onEdit: (stateId: string) => void;
  onDiscuss: (stateId: string) => void;
  onSave: (state: LoopState) => void;
  onCancelEdit: () => void;
  onAddStep: () => void;
}) {
  const stateById = new Map(loop.states.map((state) => [state.id, state]));
  const cycleStartIndex = sequence.loopBack?.targetIndex ?? 0;
  const domainStates = sequence.loopBack
    ? sequence.states.slice(cycleStartIndex)
    : sequence.states;
  const domainIds = new Set(domainStates.map((state) => state.id));
  const setupStates = sequence.states.slice(0, cycleStartIndex);
  const runtimeStates = loop.states.filter((state) => !domainIds.has(state.id));
  const focusedState =
    domainStates.find((state) => state.id === focusedStateId) ??
    domainStates[0] ??
    loop.states[0];

  const changeZoom = (direction: -1 | 1) => {
    onZoomChange(Math.max(0, Math.min(2, zoom + direction)) as FlowZoom);
  };

  const describeTarget = (transition: LoopTransition) =>
    stateById.get(transition.to)?.name ?? transition.to;

  const describeHandoff = (source: LoopState, targetId: string) => {
    const target = stateById.get(targetId);
    return target ? stateHandoff(source, target) : [];
  };

  const handoffRole = (source: LoopState) => {
    if (source.kind === "decide") return "Work contract";
    if (source.kind === "act") return "Result package";
    if (source.kind === "evaluate" || source.kind === "update") {
      return "Integrated state";
    }
    return "Handoff";
  };

  return (
    <>
      <div className="flow-toolbar">
        <div>
          <span className="eyebrow">Recurring project loop</span>
          <h3>{loop.name}</h3>
          <p>{FLOW_ZOOM_DESCRIPTION[zoom]}</p>
        </div>
        <div className="flow-zoom" aria-label="Change flow detail level">
          <button
            aria-label="Zoom out"
            disabled={zoom === 0}
            onClick={() => changeZoom(-1)}
            type="button"
          >
            −
          </button>
          <span>{FLOW_ZOOM_LABEL[zoom]}</span>
          <button
            aria-label="Zoom in"
            disabled={zoom === 2}
            onClick={() => changeZoom(1)}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      <div
        className={`flow-canvas flow-level-${zoom} ${sequence.loopBack ? "has-loop-return" : ""}`}
        aria-label={`Deliverable loop at ${FLOW_ZOOM_LABEL[zoom].toLowerCase()} detail`}
      >
        <ol className="flow-spine">
          {domainStates.map((state, index) => {
            const link = sequence.links.find((item) => item.sourceId === state.id);
            const usualTransition =
              link?.transition ??
              (sequence.loopBack?.sourceId === state.id
                ? sequence.loopBack.transition
                : null);
            const isFocused = focusedState?.id === state.id;
            const isCycleStart = sequence.loopBack?.targetId === state.id;
            const isTestSource = currentWiringStep?.sourceId === state.id;
            const isTestTarget = currentWiringStep?.targetId === state.id;
            const handoff = link
              ? describeHandoff(state, link.targetId)
              : sequence.loopBack?.sourceId === state.id
                ? describeHandoff(state, sequence.loopBack.targetId)
                : [];

            return (
              <li className="flow-row" key={state.id}>
                <div className="flow-row-main">
                  <button
                    className={`flow-state-node ${isFocused ? "is-focused" : ""} ${isCycleStart ? "is-cycle-start" : ""} ${isTestSource ? "is-test-source" : ""} ${isTestTarget ? "is-test-target" : ""}`}
                    onClick={() => onFocus(state.id)}
                    type="button"
                  >
                    <span className="flow-state-number">{index + 1}</span>
                    <span className="flow-state-copy">
                      {zoom > 0 && <small>{STATE_KIND_LABEL[state.kind]}</small>}
                      <strong>{state.name}</strong>
                      {zoom > 0 && <em>{state.summary}</em>}
                    </span>
                    {isCycleStart && (
                      <span className="flow-state-tag">
                        Loop starts
                      </span>
                    )}
                  </button>
                </div>

                {link && (
                  <div
                    className={`flow-connector ${currentWiringStep?.transition.id === link.transition.id ? "is-testing" : ""}`}
                  >
                    <span aria-hidden="true">↓</span>
                    {zoom > 0 && (
                      <div className={`${handoff.length ? "" : "is-missing"} ${state.kind === "act" ? "is-result" : ""}`}>
                        <strong>{handoffSummary(handoff)}</strong>
                        {zoom === 2 && <small>{handoffRole(state)}</small>}
                        {zoom === 2 && usualTransition && (
                          <em>{usualTransition.when}</em>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {sequence.loopBack ? (
          <button
            className={`flow-loop-return ${currentWiringStep?.transition.id === sequence.loopBack.transition.id ? "is-testing" : ""}`}
            aria-label={`Loop back to ${stateById.get(sequence.loopBack.targetId)?.name}`}
            onClick={() => onFocus(sequence.loopBack!.targetId)}
            type="button"
          >
            <span className="flow-loop-return-arrow" aria-hidden="true">←</span>
            <span className="flow-loop-return-copy">
              <strong>Back to step {sequence.loopBack.targetIndex + 1}</strong>
              {zoom > 0 && <small>
                {handoffSummary(describeHandoff(
                  stateById.get(sequence.loopBack.sourceId)!,
                  sequence.loopBack.targetId,
                ))}
              </small>}
              {zoom === 2 && (
                <em>{handoffRole(stateById.get(sequence.loopBack.sourceId)!)}</em>
              )}
              {zoom === 2 && <em>{sequence.loopBack.transition.when}</em>}
            </span>
          </button>
        ) : (
          <div className="flow-loop-missing">The route does not return yet.</div>
        )}

      </div>

      {(loop.boundaries.length > 0 || runtimeStates.length > 0) && (
        <details className="flow-runtime-policies">
          <summary>
            <span>Runtime safeguards</span>
            <small>Setup, recovery, human, budget, and completion stay outside the result loop</small>
          </summary>
          <div>
            {loop.boundaries.map((boundary) => (
              <div key={boundary.id}>
                <strong>{boundary.name}</strong>
                <small>{zoom === 2 ? boundary.description : boundary.kind}</small>
              </div>
            ))}
            {setupStates.length > 0 && (
              <div>
                <strong>First-time setup</strong>
                <small>{setupStates.map((state) => state.name).join(" · ")}</small>
              </div>
            )}
            {runtimeStates.filter((state) => !setupStates.some((setup) => setup.id === state.id)).length > 0 && (
              <div>
                <strong>Runtime handlers</strong>
                <small>
                  {runtimeStates
                    .filter((state) => !setupStates.some((setup) => setup.id === state.id))
                    .map((state) => state.name)
                    .join(" · ")}
                </small>
              </div>
            )}
          </div>
        </details>
      )}

      {focusedState && zoom === 2 && (
        <section className="flow-focus flow-focus-level-2">
          {editing === focusedState.id ? (
            <StateEditor
              disabled={disabled}
              onCancel={onCancelEdit}
              onSave={onSave}
              state={focusedState}
              states={loop.states}
            />
          ) : (
            <>
              <div className="flow-focus-heading">
                <div>
                  <span>{STATE_KIND_LABEL[focusedState.kind]}</span>
                  <strong>{focusedState.name}</strong>
                  <p>{focusedState.summary}</p>
                </div>
                <div>
                  <button onClick={() => onDiscuss(focusedState.id)} type="button">
                    Discuss
                  </button>
                  <button
                    onClick={() => {
                      onEdit(focusedState.id);
                      if (zoom < 2) onZoomChange(2);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                </div>
              </div>

              <div className="flow-contract">
                  <div className="flow-contract-inputs">
                    <span>Input handoff</span>
                    <ul>
                      {(focusedState.reads.length ? focusedState.reads : ["Nothing declared"]).map(
                        (item) => <li key={item}>{item}</li>,
                      )}
                    </ul>
                  </div>
                  <div className="flow-contract-outputs">
                    <span>{focusedState.kind === "act" ? "Result package" : "Output handoff"}</span>
                    <ul>
                      {(focusedState.writes.length ? focusedState.writes : ["Nothing declared"]).map(
                        (item) => <li key={item}>{item}</li>,
                      )}
                    </ul>
                  </div>
                  <div className="flow-contract-instruction">
                    <span>What the agent does</span>
                    <p>{focusedState.instruction}</p>
                  </div>
                  <div className="flow-contract-exit">
                    <span>Exits when</span>
                    <p>{focusedState.completion}</p>
                  </div>
                  <div className="flow-contract-paths">
                    <span>Exit outcomes</span>
                    {focusedState.transitions.length ? (
                      focusedState.transitions.map((transition) => (
                        <button
                          key={transition.id}
                          onClick={() => onFocus(transition.to)}
                          type="button"
                        >
                          <strong>{transition.when}</strong>
                          <small>
                            {TRANSITION_KIND_LABEL[transition.kind]} → {describeTarget(transition)}
                          </small>
                        </button>
                      ))
                    ) : (
                      <p>No next state. This is an accepted outcome.</p>
                    )}
                  </div>
              </div>
            </>
          )}
        </section>
      )}

      {sequence.loopBack && (
        <button
          className="add-step-button"
          disabled={disabled}
          onClick={onAddStep}
          type="button"
        >
          + Add a domain step before the loop repeats
        </button>
      )}
    </>
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
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isConversationChanging, setIsConversationChanging] = useState(false);
  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activity, setActivity] = useState("Ready");
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [focusedFlowStateId, setFocusedFlowStateId] = useState<string | null>(null);
  const [flowZoom, setFlowZoom] = useState<FlowZoom>(0);
  const [editing, setEditing] = useState<"overview" | string | null>(null);
  const [parseError, setParseError] = useState<string | null>(initialError);
  const [wiringTestStatus, setWiringTestStatus] =
    useState<WiringTestStatus>("idle");
  const [wiringTestIndex, setWiringTestIndex] = useState(-1);
  const [testedTransitionIds, setTestedTransitionIds] = useState<string[]>([]);
  const [isAgentTesting, setIsAgentTesting] = useState(false);
  const [agentTestActivity, setAgentTestActivity] = useState("Ready");
  const [agentTest, setAgentTest] = useState<AgentTestResult | null>(null);
  const [testResolutionStatus, setTestResolutionStatus] =
    useState<TestResolutionStatus>("idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wiringTestRunRef = useRef(0);

  const sequence = useMemo(
    () => (loop ? primarySequence(loop) : null),
    [loop],
  );
  const findings = useMemo(() => (loop ? validateLoop(loop) : []), [loop]);
  const blockingFindings = findings.filter((item) => item.severity === "error");
  const conversationList = conversations ?? [];
  const activeConversation = conversationList.find(
    (conversation) => conversation.id === activeConversationId,
  );

  const applyConversationPayload = useCallback(
    (payload: ConversationPayload) => {
      setActiveConversationId(payload.activeConversationId ?? null);
      setMessages(payload.messages ?? []);
      setConversations(payload.conversations ?? []);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const [healthResponse, loopResponse, conversationResponse, testResponse] = await Promise.all([
        fetch(`${DAEMON_URL}/api/health`),
        fetch(`${DAEMON_URL}/api/loop`),
        fetch(`${DAEMON_URL}/api/conversation`),
        fetch(`${DAEMON_URL}/api/test`),
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
      if (conversationResponse.ok) {
        applyConversationPayload(
          (await conversationResponse.json()) as ConversationPayload,
        );
      }
      if (testResponse.ok) {
        const payload = (await testResponse.json()) as {
          result: AgentTestResult | null;
        };
        setAgentTest(payload.result);
      }
    } catch {
      setActivity("Local bridge is offline");
    }
  }, [applyConversationPayload]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activity]);

  useEffect(() => {
    wiringTestRunRef.current += 1;
    setWiringTestStatus("idle");
    setWiringTestIndex(-1);
    setTestedTransitionIds([]);
  }, [loop?.revision]);

  useEffect(() => {
    if (!loop?.states.length) {
      setFocusedFlowStateId(null);
      return;
    }
    const domainStates = sequence?.loopBack
      ? sequence.states.slice(sequence.loopBack.targetIndex)
      : sequence?.states ?? loop.states;
    setFocusedFlowStateId((current) =>
      current && domainStates.some((state) => state.id === current)
        ? current
        : domainStates[0]?.id ?? loop.startState,
    );
  }, [loop, sequence]);

  const rememberUiMessage = (role: "loopit" | "error", text: string) => {
    void fetch(`${DAEMON_URL}/api/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, text }),
    });
  };

  const startNewConversation = async () => {
    if (isWorking || isAgentTesting || isConversationChanging) return;
    setIsConversationChanging(true);
    try {
      const response = await fetch(`${DAEMON_URL}/api/conversations/new`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not start a new conversation.");
      applyConversationPayload(payload as ConversationPayload);
      setInput("");
      setSelectedStateId(null);
      setIsHistoryOpen(false);
      setActivity("Ready");
    } catch (error) {
      setMessages((current) => [
        ...current,
        newMessage(
          "error",
          error instanceof Error ? error.message : "Could not start a new conversation.",
        ),
      ]);
    } finally {
      setIsConversationChanging(false);
    }
  };

  const activateConversation = async (id: string) => {
    if (
      id === activeConversationId ||
      isWorking ||
      isAgentTesting ||
      isConversationChanging
    ) {
      setIsHistoryOpen(false);
      return;
    }
    setIsConversationChanging(true);
    try {
      const response = await fetch(`${DAEMON_URL}/api/conversations/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not open that conversation.");
      applyConversationPayload(payload as ConversationPayload);
      setInput("");
      setSelectedStateId(null);
      setIsHistoryOpen(false);
      setActivity("Ready");
    } catch (error) {
      setMessages((current) => [
        ...current,
        newMessage(
          "error",
          error instanceof Error ? error.message : "Could not open that conversation.",
        ),
      ]);
    } finally {
      setIsConversationChanging(false);
    }
  };

  const sendMessage = async (
    textOverride?: string,
    displayText?: string,
    allowDuringTest = false,
  ) => {
    const text = (textOverride ?? input).trim();
    if (!text || isWorking || (isAgentTesting && !allowDuringTest)) return;

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
          displayText: displayText ?? text,
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
      const conversationResponse = await fetch(`${DAEMON_URL}/api/conversation`);
      if (conversationResponse.ok) {
        applyConversationPayload(
          (await conversationResponse.json()) as ConversationPayload,
        );
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
    if (isSaving || isWorking || isAgentTesting) return null;
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
      const message = `${note} Saved to loop.md; the agent will read revision ${saved.revision} on the next turn.`;
      setMessages((current) => [
        ...current,
        newMessage("loopit", message),
      ]);
      rememberUiMessage("loopit", message);
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
      setFocusedFlowStateId(id);
      setFlowZoom(2);
      setEditing(id);
    }
  };

  const interrupt = async () => {
    await fetch(`${DAEMON_URL}/api/interrupt`, { method: "POST" }).catch(
      () => undefined,
    );
    if (isAgentTesting) setAgentTestActivity("Stopping rehearsal");
    if (isWorking) setActivity("Stopping agent");
  };

  const otherTransitions =
    loop && sequence
      ? loop.states.flatMap((state) =>
          state.transitions
            .filter((transition) => !sequence.chosenTransitionIds.has(transition.id))
            .map((transition) => ({ state, transition })),
        )
      : [];
  const domainStateCount = sequence
    ? sequence.loopBack
      ? sequence.states.length - sequence.loopBack.targetIndex
      : sequence.states.length
    : 0;
  const stateById = new Map(loop?.states.map((state) => [state.id, state]) ?? []);

  const wiringTestSteps: WiringTestStep[] = sequence
    ? [
        ...sequence.links.map((link) => ({ ...link, lane: "usual" as const })),
        ...(sequence.loopBack
          ? [{ ...sequence.loopBack, lane: "repeat" as const }]
          : []),
        ...otherTransitions.map(({ state, transition }) => ({
          sourceId: state.id,
          targetId: transition.to,
          transition,
          lane: "edge" as const,
        })),
      ]
    : [];
  const expectedTransitionCount =
    loop?.states.reduce((total, state) => total + state.transitions.length, 0) ?? 0;
  const currentWiringStep = wiringTestSteps[wiringTestIndex] ?? null;

  const runWiringTest = async () => {
    if (!loop || !sequence || wiringTestStatus === "running") return;
    const runId = wiringTestRunRef.current + 1;
    wiringTestRunRef.current = runId;
    setWiringTestStatus("running");
    setWiringTestIndex(-1);
    setTestedTransitionIds([]);

    for (let index = 0; index < wiringTestSteps.length; index += 1) {
      if (wiringTestRunRef.current !== runId) return;
      setWiringTestIndex(index);
      await new Promise((resolve) => window.setTimeout(resolve, 480));
      if (wiringTestRunRef.current !== runId) return;
      setTestedTransitionIds((current) => [
        ...current,
        wiringTestSteps[index].transition.id,
      ]);
    }

    setWiringTestIndex(-1);
    const passed =
      Boolean(sequence.loopBack) &&
      blockingFindings.length === 0 &&
      wiringTestSteps.length === expectedTransitionCount;
    setWiringTestStatus(passed ? "passed" : "failed");

    const summary = passed
      ? `Quick wiring test passed for loop revision ${loop.revision}: the recurrence closed and all ${expectedTransitionCount} declared transitions were traced.`
      : `Quick wiring test found a problem in loop revision ${loop.revision}. The loop did not close cleanly or not every declared transition could be traced.`;
    setMessages((current) => [...current, newMessage("loopit", summary)]);
    rememberUiMessage("loopit", summary);
  };

  const runAgentTest = async () => {
    if (!loop || isWorking || isAgentTesting) return;
    setTestResolutionStatus("idle");
    setIsAgentTesting(true);
    setAgentTestActivity(
      `Starting a fresh, read-only ${agent === "codex" ? "Codex" : "Claude"} rehearsal`,
    );

    try {
      const response = await fetch(`${DAEMON_URL}/api/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "The test agent did not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resultForResolution: AgentTestResult | null = null;
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
            setAgentTestActivity(event.text);
          }
          if (event.type === "test_report") {
            resultForResolution = event.result as AgentTestResult;
            setAgentTest(resultForResolution);
          }
          if (event.type === "error") {
            setMessages((current) => [
              ...current,
              newMessage("error", event.text),
            ]);
            setAgentTestActivity(event.text);
          }
          if (event.type === "done") {
            setAgentTestActivity(event.interrupted ? "Rehearsal stopped" : "Ready");
          }
        }
      }

      if (resultForResolution && resultForResolution.verdict !== "pass") {
        setIsAgentTesting(false);
        setTestResolutionStatus("working");
        setAgentTestActivity(
          "Resolving agent-owned gaps; human-owned gaps will become one question",
        );
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await sendMessage(
          RESOLVE_TEST_FAILURE,
          "Continue from the failed preflight",
          true,
        );
        setTestResolutionStatus("finished");
      }
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "The agent rehearsal failed.";
      setMessages((current) => [...current, newMessage("error", text)]);
      rememberUiMessage("error", text);
      setAgentTestActivity("Rehearsal unavailable");
    } finally {
      setIsAgentTesting(false);
      void refresh();
    }
  };

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
              <h1>{activeConversation?.title ?? "New conversation"}</h1>
            </div>
            <div className="panel-heading-actions">
              <div className="conversation-actions">
                <button
                  disabled={isWorking || isAgentTesting || isConversationChanging}
                  onClick={() => void startNewConversation()}
                  type="button"
                >
                  + New
                </button>
                <button
                  aria-expanded={isHistoryOpen}
                  disabled={isWorking || isAgentTesting}
                  onClick={() => setIsHistoryOpen((current) => !current)}
                  type="button"
                >
                  History {conversationList.length > 1 ? `(${conversationList.length})` : ""}
                </button>
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
          </div>

          {isHistoryOpen && (
            <section className="conversation-history" aria-label="Past conversations">
              <div className="conversation-history-heading">
                <div>
                  <span className="eyebrow">Local history</span>
                  <strong>Conversations</strong>
                </div>
                <button
                  aria-label="Close conversation history"
                  onClick={() => setIsHistoryOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="conversation-history-list">
                {conversationList.map((conversation) => (
                  <button
                    className={conversation.active ? "is-active" : ""}
                    key={conversation.id}
                    onClick={() => void activateConversation(conversation.id)}
                    type="button"
                  >
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>{conversation.preview}</small>
                    </span>
                    <em>{conversationTime(conversation)}</em>
                  </button>
                ))}
              </div>
              <p>Each conversation keeps its own local agent session.</p>
            </section>
          )}

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
                    Edit overview
                  </button>
                </div>
                {editing === "overview" ? (
                  <OverviewEditor
                    disabled={isSaving}
                    loop={loop}
                    onCancel={() => setEditing(null)}
                    onSave={(next) => void persistLoop(next, "Updated the loop overview.")}
                  />
                ) : (
                  <p className="objective-copy">{loop.objective}</p>
                )}
                <div className="loop-overview-status">
                  <div className="completion-policy-card">
                    <span>Completion</span>
                    <strong>{COMPLETION_POLICY_LABEL[loop.completionPolicy]}</strong>
                  </div>
                  <div className={`simple-health ${blockingFindings.length ? "has-errors" : "is-good"}`}>
                    <strong>
                      {blockingFindings.length
                        ? `${blockingFindings.length} structural ${blockingFindings.length === 1 ? "issue" : "issues"}`
                        : "Loop closes"}
                    </strong>
                    <span>
                      {domainStateCount} project stages · named handoffs
                    </span>
                  </div>
                </div>
              </div>

              <section className="sequence-section">
                <StateFlowCanvas
                  currentWiringStep={currentWiringStep}
                  disabled={isSaving || isWorking || isAgentTesting}
                  editing={editing}
                  focusedStateId={focusedFlowStateId}
                  loop={loop}
                  onAddStep={() => void addStepBeforeRepeat()}
                  onCancelEdit={() => setEditing(null)}
                  onDiscuss={(stateId) => setSelectedStateId(stateId)}
                  onEdit={(stateId) => {
                    setFocusedFlowStateId(stateId);
                    setEditing(stateId);
                  }}
                  onFocus={(stateId) => {
                    setFocusedFlowStateId(stateId);
                    setEditing(null);
                  }}
                  onSave={(state) => void saveState(state)}
                  onZoomChange={setFlowZoom}
                  sequence={sequence}
                  zoom={flowZoom}
                />

                <details className={`test-lab flow-test-lab is-${wiringTestStatus}`}>
                  <summary>
                    <div>
                      <span className="eyebrow">Preflight</span>
                      <strong>Test this loop</strong>
                    </div>
                    <span>
                      {wiringTestStatus === "running"
                        ? "Tracing"
                        : wiringTestStatus === "passed"
                          ? "Passed"
                          : wiringTestStatus === "failed"
                            ? "Needs repair"
                            : isAgentTesting
                              ? "Rehearsing"
                              : "Not tested"}
                    </span>
                  </summary>

                  <div className="flow-test-content">
                    <div className="test-lab-heading">
                      <p>
                        Trace the result handoffs in seconds, then ask a fresh local
                        agent to consume them without conversation context.
                      </p>
                      <div className="test-lab-actions">
                        <button
                          className="button-secondary"
                          disabled={
                            wiringTestStatus === "running" ||
                            isWorking ||
                            isAgentTesting
                          }
                          onClick={() => void runWiringTest()}
                          type="button"
                        >
                          {wiringTestStatus === "passed" ||
                          wiringTestStatus === "failed"
                            ? "Trace again"
                            : "Trace handoffs"}
                        </button>
                        {isAgentTesting ? (
                          <button
                            className="button-stop"
                            onClick={interrupt}
                            type="button"
                          >
                            Stop rehearsal
                          </button>
                        ) : (
                          <button
                            className="button-primary"
                            disabled={
                              isWorking || wiringTestStatus === "running"
                            }
                            onClick={() => void runAgentTest()}
                            type="button"
                          >
                            Test with {agent === "codex" ? "Codex" : "Claude"}
                          </button>
                        )}
                      </div>
                    </div>

                    {wiringTestStatus === "running" && currentWiringStep && (
                      <div className="test-running">
                        <div className="test-progress">
                          <span
                            style={{
                              width: `${Math.round(
                                ((wiringTestIndex + 1) /
                                  wiringTestSteps.length) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="test-now">
                          <span>
                            {currentWiringStep.lane === "repeat"
                              ? "Recurrence"
                              : currentWiringStep.lane === "edge"
                                ? "Edge path"
                                : "Usual path"}
                          </span>
                          <strong>
                            {stateById.get(currentWiringStep.sourceId)?.name}
                          </strong>
                          <i aria-hidden="true">→</i>
                          <strong>
                            {stateById.get(currentWiringStep.targetId)?.name ??
                              currentWiringStep.targetId}
                          </strong>
                          <p>{currentWiringStep.transition.when}</p>
                        </div>
                      </div>
                    )}

                    {(wiringTestStatus === "passed" ||
                      wiringTestStatus === "failed") && (
                      <div className={`wiring-result is-${wiringTestStatus}`}>
                        <span aria-hidden="true">
                          {wiringTestStatus === "passed" ? "✓" : "!"}
                        </span>
                        <div>
                          <strong>
                            {wiringTestStatus === "passed"
                              ? "The control flow closes"
                              : "The control flow needs repair"}
                          </strong>
                          <p>
                            {testedTransitionIds.length}/
                            {expectedTransitionCount} transitions traced
                            {sequence.loopBack
                              ? ` · returns to ${stateById.get(
                                  sequence.loopBack.targetId,
                                )?.name}`
                              : " · no recurrence found"}
                            {blockingFindings.length
                              ? ` · ${blockingFindings.length} blocking checks`
                              : " · no structural blockers"}
                          </p>
                        </div>
                      </div>
                    )}

                    {isAgentTesting && (
                      <div className="agent-test-running">
                        <span className="pulse-dot" />
                        <div>
                          <strong>Fresh-agent rehearsal</strong>
                          <p>{agentTestActivity}</p>
                        </div>
                      </div>
                    )}

                    {testResolutionStatus === "working" && (
                      <div className="agent-test-running is-resolution">
                        <span className="pulse-dot" />
                        <div>
                          <strong>Repairing the loop</strong>
                          <p>
                            Agent-owned gaps are being resolved. Missing human
                            intent will become one question in chat.
                          </p>
                        </div>
                      </div>
                    )}

                    {testResolutionStatus === "finished" && (
                      <div className="test-next-action">
                        <span aria-hidden="true">→</span>
                        <div>
                          <strong>The next action was initiated</strong>
                          <p>
                            Retest the revision or answer the remaining question
                            in chat.
                          </p>
                        </div>
                      </div>
                    )}

                    {agentTest && !isAgentTesting && (
                      <details
                        className={`agent-test-result is-${agentTest.verdict}`}
                      >
                        <summary>
                          <span>
                            {agentTest.verdict === "pass"
                              ? "PASS"
                              : agentTest.verdict === "risk"
                                ? "NEEDS INPUT"
                                : "REPAIR"}
                          </span>
                          <div>
                            <strong>Fresh-agent rehearsal</strong>
                            <small>
                              Revision {agentTest.loopRevision ?? "?"}
                              {agentTest.loopRevision !== loop.revision &&
                                " · out of date"}
                            </small>
                          </div>
                          <i>Report</i>
                        </summary>
                        <pre>{agentTest.report}</pre>
                      </details>
                    )}
                  </div>
                </details>
              </section>
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
                            setFocusedFlowStateId(finding.elementId);
                            setFlowZoom(2);
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
