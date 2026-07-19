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
import { primarySequence } from "@/lib/loop-flow";
import { validateLoop } from "@/lib/loop-validation";

const DAEMON_URL = "http://127.0.0.1:4318";
const START_CONSTRUCTION =
  "Begin first-time loop construction. No loop exists yet. Ask me one focused question about what work I want to keep progressing before proposing any states.";
const RESOLVE_TEST_FAILURE = `The latest .loopit/test-report.md found unresolved preflight issues. Treat this result as the next construction action, never as a reason to stop.

Read both .loopit/loop.md and .loopit/test-report.md. Classify every issue by ownership:
- Agent-owned: missing control logic, recovery, initialization, state contract, transition priority, or artifact scaffold that an agent can define safely. Resolve these now by making the smallest coherent update to loop.md.
- Human-owned: product intent, acceptance threshold, permission, credential, sensitive fact, risk choice, or policy that the agent must not invent. After resolving agent-owned issues, ask exactly one focused question for the highest-leverage missing human input.
- Runtime evidence: behavior that only a later sandbox execution can prove. Encode the responsible action, evidence, failure route, and retry or interrupt boundary; do not claim it already passed.

Every failure, missing artifact, absent evidence, ended agent turn, and tool error must lead to an explicit repair, retry, durable update, human interrupt, or completion transition. Do not leave a silent stop. Explain the next action concisely.`;

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
  const sequenceIds = new Set(sequence?.states.map((state) => state.id) ?? []);
  const otherStates = loop?.states.filter((state) => !sequenceIds.has(state.id)) ?? [];
  const sequenceIndex = new Map(
    sequence?.states.map((state, index) => [state.id, index]) ?? [],
  );
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

  const describeTarget = (transition: LoopTransition, sourceIndex?: number) => {
    const targetIndex = sequenceIndex.get(transition.to);
    if (targetIndex !== undefined) {
      const movement =
        sourceIndex !== undefined && targetIndex <= sourceIndex
          ? "Re-enter"
          : "Go to";
      return `${movement} step ${targetIndex + 1}: ${stateById.get(transition.to)?.name}`;
    }
    return `Go to: ${stateById.get(transition.to)?.name ?? transition.to}`;
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
                <div className="completion-policy-card">
                  <span>Completion policy</span>
                  <div>
                    <strong>{COMPLETION_POLICY_LABEL[loop.completionPolicy]}</strong>
                    <p>{COMPLETION_POLICY_DESCRIPTION[loop.completionPolicy]}</p>
                  </div>
                </div>
                <div className={`simple-health ${blockingFindings.length ? "has-errors" : "is-good"}`}>
                  <strong>
                    {blockingFindings.length
                      ? `${blockingFindings.length} structural ${blockingFindings.length === 1 ? "issue" : "issues"}`
                      : "The loop can repeat"}
                  </strong>
                  <span>
                    {blockingFindings.length
                      ? "Open checks below or ask the agent to repair them."
                      : otherTransitions.length
                        ? `The repeating route has ${otherTransitions.length} conditional ${otherTransitions.length === 1 ? "path" : "paths"}.`
                        : "The current definition is one repeating route with no branches yet."}
                  </span>
                </div>
              </div>

              <section className="sequence-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">State flow</span>
                    <h3>The usual route and its choices</h3>
                    <p>
                      Follow the center path for one iteration. Conditional paths
                      stay beside the state that chooses them.
                    </p>
                  </div>
                  <span>
                    {sequence.states.length} usual {sequence.states.length === 1 ? "state" : "states"}
                    {otherTransitions.length > 0 && ` · ${otherTransitions.length} side ${otherTransitions.length === 1 ? "path" : "paths"}`}
                  </span>
                </div>

                <div className={`test-lab is-${wiringTestStatus}`}>
                  <div className="test-lab-heading">
                    <div>
                      <span className="eyebrow">Preflight</span>
                      <h4>Prove the loop before real work</h4>
                      <p>
                        First trace every declared transition. Then let a fresh,
                        read-only agent challenge the state contracts. Any problem
                        automatically becomes the next construction action.
                      </p>
                    </div>
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
                        {wiringTestStatus === "passed" || wiringTestStatus === "failed"
                          ? "Trace again"
                          : "Trace every path"}
                      </button>
                      {isAgentTesting ? (
                        <button className="button-stop" onClick={interrupt} type="button">
                          Stop rehearsal
                        </button>
                      ) : (
                        <button
                          className="button-primary"
                          disabled={isWorking || wiringTestStatus === "running"}
                          onClick={() => void runAgentTest()}
                          type="button"
                        >
                          Test with {agent === "codex" ? "Codex" : "Claude"}
                        </button>
                      )}
                    </div>
                  </div>

                  {wiringTestStatus === "idle" &&
                    !isAgentTesting &&
                    testResolutionStatus === "idle" && (
                    <div className="test-explanation">
                      <span>1</span>
                      <p><strong>Wiring test</strong> takes seconds and animates the recurrence, branches, interrupts, and completion exits.</p>
                      <span>2</span>
                      <p><strong>Agent rehearsal</strong> starts without chat history. Agent-owned gaps are repaired; human-owned gaps become one question.</p>
                    </div>
                  )}

                  {wiringTestStatus === "running" && currentWiringStep && (
                    <div className="test-running">
                      <div className="test-progress">
                        <span
                          style={{
                            width: `${Math.round(
                              ((wiringTestIndex + 1) / wiringTestSteps.length) * 100,
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
                        <strong>{stateById.get(currentWiringStep.sourceId)?.name}</strong>
                        <i aria-hidden="true">→</i>
                        <strong>
                          {stateById.get(currentWiringStep.targetId)?.name ??
                            currentWiringStep.targetId}
                        </strong>
                        <p>{currentWiringStep.transition.when}</p>
                      </div>
                    </div>
                  )}

                  {(wiringTestStatus === "passed" || wiringTestStatus === "failed") && (
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
                          {testedTransitionIds.length}/{expectedTransitionCount} transitions
                          traced
                          {sequence.loopBack
                            ? ` · recurrence returns to ${stateById.get(sequence.loopBack.targetId)?.name}`
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
                        <strong>Failure became the next action</strong>
                        <p>
                          The construction agent is resolving what it owns. If
                          intent, permission, or policy is missing, it will ask one
                          focused question in chat.
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
                          Retest the updated revision, or answer the agent’s question
                          in chat if the remaining gap belongs to you.
                        </p>
                      </div>
                    </div>
                  )}

                  {agentTest && !isAgentTesting && (
                    <details className={`agent-test-result is-${agentTest.verdict}`} open>
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
                            {agentTest.loopRevision !== loop.revision && " · out of date"}
                            {agentTest.testedAt &&
                              ` · ${new Date(agentTest.testedAt).toLocaleString()}`}
                          </small>
                        </div>
                        <i>View report</i>
                      </summary>
                      <pre>{agentTest.report}</pre>
                    </details>
                  )}
                </div>

                <ol className="step-sequence">
                  {sequence.states.map((state, index) => {
                    const link = sequence.links.find((item) => item.sourceId === state.id);
                    const isCycleStart = sequence.loopBack?.targetId === state.id;
                    const isBeforeCycle =
                      sequence.loopBack !== null &&
                      index < sequence.loopBack.targetIndex;
                    const hasChoice = state.transitions.length > 1;
                    const isTestSource = currentWiringStep?.sourceId === state.id;
                    const isTestTarget = currentWiringStep?.targetId === state.id;
                    return (
                      <li key={state.id}>
                        <article
                          className={`step-card ${isCycleStart ? "is-cycle-start" : ""} ${isTestSource ? "is-test-source" : ""} ${isTestTarget ? "is-test-target" : ""}`}
                        >
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
                                  {isBeforeCycle && <strong>First pass only</strong>}
                                  {isCycleStart && <strong>Repeats from here</strong>}
                                </div>
                                <h4>{state.name}</h4>
                                <p>{state.summary}</p>
                                <div className="done-when">
                                  <span>State exits when</span>
                                  {state.completion}
                                </div>
                                {hasChoice && (
                                  <div className="state-paths">
                                    <div className="state-paths-heading">
                                      <strong>Decision here</strong>
                                      <span>{state.transitions.length} possible paths</span>
                                    </div>
                                    {state.transitions.map((transition) => {
                                      const isUsual = sequence.chosenTransitionIds.has(transition.id);
                                      const isTesting =
                                        currentWiringStep?.transition.id === transition.id;
                                      const wasTested = testedTransitionIds.includes(
                                        transition.id,
                                      );
                                      return (
                                        <button
                                          className={`${isUsual ? "is-usual" : ""} ${isTesting ? "is-testing" : ""} ${wasTested ? "was-tested" : ""}`}
                                          key={transition.id}
                                          onClick={() => {
                                            setSelectedStateId(state.id);
                                            setEditing(state.id);
                                          }}
                                          type="button"
                                        >
                                          <i aria-hidden="true">{isUsual ? "↓" : "↳"}</i>
                                          <span>
                                            <strong>{transition.when}</strong>
                                            <small>
                                              {isUsual ? "Usual route" : TRANSITION_KIND_LABEL[transition.kind]}
                                              {" · "}{describeTarget(transition, index)}
                                            </small>
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
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
                          <div
                            className={`step-connector ${hasChoice ? "has-choice" : ""} ${currentWiringStep?.transition.id === link.transition.id ? "is-testing" : ""}`}
                          >
                            <span aria-hidden="true">↓</span>
                            <p>
                              {hasChoice && <strong>Usual route · </strong>}
                              {link.transition.when}
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>

                {sequence.loopBack ? (
                  <div
                    className={`loop-back ${currentWiringStep?.transition.id === sequence.loopBack.transition.id ? "is-testing" : ""}`}
                  >
                    <span aria-hidden="true">↺</span>
                    <div>
                      <strong>
                        Next iteration re-enters at step {sequence.loopBack.targetIndex + 1}: {loop.states.find((state) => state.id === sequence.loopBack?.targetId)?.name}
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

                {otherStates.length > 0 && (
                  <div className="branch-states">
                    <div className="branch-states-heading">
                      <div>
                        <strong>States outside the usual route</strong>
                        <span>Reached only when a conditional path is taken.</span>
                      </div>
                      <span>{otherStates.length}</span>
                    </div>
                    <div className="branch-state-list">
                      {otherStates.map((state) => {
                        const incoming = loop.states.flatMap((source) =>
                          source.transitions
                            .filter((transition) => transition.to === state.id)
                            .map((transition) => ({ source, transition })),
                        );
                        return (
                          <article
                            className={`branch-state-card ${currentWiringStep?.sourceId === state.id ? "is-test-source" : ""} ${currentWiringStep?.targetId === state.id ? "is-test-target" : ""}`}
                            key={state.id}
                          >
                            <div className="branch-state-topline">
                              <span>{STATE_KIND_LABEL[state.kind]}</span>
                              <button
                                onClick={() => {
                                  setSelectedStateId(state.id);
                                  setEditing(state.id);
                                }}
                                type="button"
                              >
                                Edit
                              </button>
                            </div>
                            <strong>{state.name}</strong>
                            <p>{state.summary}</p>
                            {incoming.length > 0 && (
                              <div className="branch-connections">
                                <span>Entered from</span>
                                {incoming.map(({ source, transition }) => (
                                  <small key={transition.id}>
                                    {source.name} · {transition.when}
                                  </small>
                                ))}
                              </div>
                            )}
                            {state.transitions.length > 0 && (
                              <div className="branch-connections">
                                <span>Then</span>
                                {state.transitions.map((transition) => (
                                  <small key={transition.id}>
                                    {transition.when} · {describeTarget(transition)}
                                  </small>
                                ))}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {sequence.loopBack && (
                  <button
                    className="add-step-button"
                    disabled={isSaving || isWorking || isAgentTesting}
                    onClick={() => void addStepBeforeRepeat()}
                    type="button"
                  >
                    + Add a step before the loop repeats
                  </button>
                )}
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
