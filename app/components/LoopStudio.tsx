"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CompletionPolicy,
  LoopDefinition,
  LoopState,
  LoopTransition,
  StartingPackageItem,
  StartingPackageRole,
  StateKind,
  TransitionKind,
} from "@/lib/loop-types";
import { primarySequence, stateHandoff } from "@/lib/loop-flow";
import type { PrimarySequence } from "@/lib/loop-flow";
import { validateLoop } from "@/lib/loop-validation";
import {
  extractHumanReview,
  type HumanReviewRequest,
} from "@/lib/human-review";

const DAEMON_URL = "http://127.0.0.1:4318";
const START_CONSTRUCTION =
  "Begin first-time loop construction. No loop exists yet. Ask me one focused question about what work I want to keep progressing. Once the objective is clear, complete the proposal in this turn: list the specific hypotheses, features, design questions, opportunities, cases, or equivalent that I will actually track; choose one exact first task; propose the recognizable recurring work cycle; and specify the separate setup needed to begin. Inspect what exists, choose safe reversible defaults, and do not make me ask again for initial work, methods, models, tools, baselines, or tests.";
const RESOLVE_TEST_FAILURE = `The latest .loopit/test-report.md found unresolved preflight issues. Treat this result as the next construction action, never as a reason to stop.

Read both .loopit/loop.md and .loopit/test-report.md. Classify every issue by ownership:
- Agent-owned: parser or schema errors; missing IDs; invalid Kind or Role values; validator wording; missing, broad, or generic starting work; placeholder setup; missing domain handoff; unclear native deliverable; incomplete Result package; inconsistent artifact ownership; or state integration logic that an agent can define safely. Resolve these now in one smallest coherent structured loop update. Never ask the human to choose a machine field.
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
  appRoot: string;
  projectRoot: string;
  projectName: string;
  runtimeAllowed: boolean;
  runtimeBlockedReason: string | null;
  active: boolean;
  activePurpose?: "test" | "runtime" | null;
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

interface ActivityEntry {
  id: string;
  at: string | null;
  text: string;
  detail: string | null;
  kind: string;
  status: "active" | "complete";
}

interface RuntimeRun {
  id: string;
  loopRevision: number | null;
  agent: AgentName;
  active: boolean;
  status: "running" | "paused" | "failed" | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  activities?: ActivityEntry[];
}

interface WiringTestStep {
  sourceId: string;
  targetId: string;
  transition: LoopTransition;
  lane: "usual" | "repeat" | "edge";
}

type WiringTestStatus = "idle" | "running" | "passed" | "failed";
type TestPathTone = "pending" | "active" | "complete" | "action";
type UnifiedTestStage =
  | "idle"
  | "tracing"
  | "rehearsing"
  | "repairing"
  | "retesting"
  | "passed"
  | "needs-attention";
type FlowZoom = 0 | 1 | 2;

const ACTIVE_TEST_STAGES: UnifiedTestStage[] = [
  "tracing",
  "rehearsing",
  "repairing",
  "retesting",
];

const TEST_STAGE_LABEL: Record<UnifiedTestStage, string> = {
  idle: "Not tested",
  tracing: "Checking flow",
  rehearsing: "Testing",
  repairing: "Fixing",
  retesting: "Retesting",
  passed: "Passed",
  "needs-attention": "Needs input",
};

const FLOW_ZOOM_LABEL: Record<FlowZoom, string> = {
  0: "Overview",
  1: "Handoffs",
  2: "Rules",
};

const FLOW_ZOOM_DESCRIPTION: Record<FlowZoom, string> = {
  0: "The work cycle in project language",
  1: "What each step produces for the next",
  2: "Instructions, evidence, and exit rules",
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

const STARTING_PACKAGE_ORDER: StartingPackageRole[] = [
  "state",
  "frontier",
  "foundation",
  "first-work",
];

const STARTING_WORK_ROLES: StartingPackageRole[] = [
  "state",
  "frontier",
  "first-work",
];

const STARTING_PACKAGE_EDIT_PROMPT: Record<StartingPackageRole, string> = {
  state: "What is already known",
  frontier: "What remains to pursue",
  foundation: "What is ready to use",
  "first-work": "What to do first",
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

function mergeStartingPackage(
  current: StartingPackageItem[],
  changed: StartingPackageItem[],
) {
  return STARTING_PACKAGE_ORDER.map(
    (role) =>
      changed.find((item) => item.role === role) ??
      current.find((item) => item.role === role),
  ).filter(Boolean) as StartingPackageItem[];
}

function compactContent(content: string, index: number) {
  const value = content.trim();
  let label = value;
  let detail = "";

  const quotedLabel = value.match(/^`([^`]+)`\s*(?:—|:|-)?\s*(.*)$/);
  const leadingCode = value.match(
    /^(?:use|run|build with|start with)\s+`([^`]+)`\s*(.*)$/i,
  );
  const divided = value.match(/^(.+?)(?:\s+—\s+|:\s+)(.+)$/);

  if (quotedLabel) {
    label = quotedLabel[1];
    detail = quotedLabel[2];
  } else if (leadingCode) {
    label = leadingCode[1];
    detail = value;
  } else if (divided) {
    label = divided[1];
    detail = divided[2];
  } else if (value.length > 74) {
    const sentenceEnd = value.search(/[.;]/);
    if (sentenceEnd > 18 && sentenceEnd < 74) {
      label = value.slice(0, sentenceEnd);
      detail = value;
    } else {
      label = `${value.slice(0, 71).trimEnd()}…`;
      detail = value;
    }
  }

  detail = detail.replace(/^[—:\-]\s*/, "").trim();
  const hypothesis = label.match(/^(H\d+)\s*(?:—|-)?\s*(.*)$/i);

  return {
    marker: hypothesis?.[1] ?? String(index + 1).padStart(2, "0"),
    label: hypothesis?.[2] || label,
    detail: detail === label ? "" : detail,
  };
}

function summarizeLoopChanges(
  before: LoopDefinition,
  after: LoopDefinition,
) {
  const changes: string[] = [];
  if (before.name !== after.name || before.objective !== after.objective) {
    changes.push("Updated the loop objective");
  }
  if (before.startState !== after.startState) {
    changes.push("Updated where the cycle begins");
  }
  const beforeStarting = new Map(
    before.startingPackage.map((item) => [item.role, item]),
  );

  after.startingPackage.forEach((item) => {
    const previous = beforeStarting.get(item.role);
    if (JSON.stringify(previous) === JSON.stringify(item)) return;
    changes.push(
      item.role === "foundation"
        ? `Updated setup: ${item.name}`
        : `Updated starting work: ${item.name}`,
    );
  });

  const beforeStates = new Map(before.states.map((state) => [state.id, state]));
  const afterStateIds = new Set(after.states.map((state) => state.id));
  after.states.forEach((state) => {
    const previous = beforeStates.get(state.id);
    if (!previous) changes.push(`Added cycle step: ${state.name}`);
    else if (JSON.stringify(previous) !== JSON.stringify(state)) {
      changes.push(`Updated cycle step: ${state.name}`);
    }
  });
  before.states.forEach((state) => {
    if (!afterStateIds.has(state.id)) changes.push(`Removed cycle step: ${state.name}`);
  });

  if (JSON.stringify(before.artifacts) !== JSON.stringify(after.artifacts)) {
    changes.push("Updated handoff definitions");
  }
  if (JSON.stringify(before.boundaries) !== JSON.stringify(after.boundaries)) {
    changes.push("Updated pause or stopping rules");
  }
  if (before.completionPolicy !== after.completionPolicy) {
    changes.push("Updated the completion policy");
  }

  return changes.length
    ? changes
    : ["No automatic loop changes were needed"];
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

function formatRuntimeDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days ? `${days}d ${clock}` : clock;
}

function activityEntry(event: Record<string, unknown>): ActivityEntry {
  return {
    id:
      String(event.id || "") ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: typeof event.at === "string" ? event.at : null,
    text: String(event.text || "Agent is working"),
    detail: typeof event.detail === "string" ? event.detail : null,
    kind: typeof event.kind === "string" ? event.kind : "activity",
    status: event.status === "complete" ? "complete" : "active",
  };
}

function appendActivity(
  current: ActivityEntry[],
  event: Record<string, unknown>,
) {
  return [...current, activityEntry(event)].slice(-24);
}

function ActivityFeed({
  entries,
  label,
}: {
  entries: ActivityEntry[];
  label: string;
}) {
  if (!entries.length) return null;
  return (
    <div aria-label={label} aria-live="polite" className="activity-feed" role="log">
      {entries.slice(-8).map((entry) => (
        <div className={`activity-entry is-${entry.status}`} key={entry.id}>
          <span aria-hidden="true">
            {entry.status === "complete" ? "✓" : "·"}
          </span>
          <div>
            <strong>{entry.text}</strong>
            {entry.detail && <small>{entry.detail}</small>}
          </div>
        </div>
      ))}
    </div>
  );
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

function StartingPackageEditor({
  items,
  roles,
  saveLabel,
  disabled,
  onCancel,
  onSave,
}: {
  items: StartingPackageItem[];
  roles: StartingPackageRole[];
  saveLabel: string;
  disabled: boolean;
  onCancel: () => void;
  onSave: (items: StartingPackageItem[]) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(items ?? []));

  const updateItem = (
    role: StartingPackageRole,
    update: Partial<StartingPackageItem>,
  ) => {
    setDraft((current) =>
      current.map((item) =>
        item.role === role ? { ...item, ...update } : item,
      ),
    );
  };

  const ordered = roles.map((role) =>
    draft.find((item) => item.role === role),
  ).filter(Boolean) as StartingPackageItem[];
  const canSave =
    ordered.length === roles.length &&
    ordered.every(
      (item) =>
        item.name.trim() &&
        item.description.trim() &&
        item.initialContents.length > 0,
    );

  return (
    <div className="inline-editor starting-package-editor">
      {ordered.map((item) => (
        <section key={item.role}>
          <span>{STARTING_PACKAGE_EDIT_PROMPT[item.role]}</span>
          <label>
            Name people in this field would use
            <input
              onChange={(event) =>
                updateItem(item.role, { name: event.target.value })
              }
              value={item.name}
            />
          </label>
          <label>
            What this contains
            <textarea
              onChange={(event) =>
                updateItem(item.role, { description: event.target.value })
              }
              rows={3}
              value={item.description}
            />
          </label>
          <label>
            Initial items, one per line
            <textarea
              onChange={(event) =>
                updateItem(item.role, {
                  initialContents: splitLines(event.target.value),
                })
              }
              rows={4}
              value={item.initialContents.join("\n")}
            />
          </label>
        </section>
      ))}
      <div className="editor-actions">
        <button className="button-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="button-primary"
          disabled={disabled || !canSave}
          onClick={() => onSave(ordered)}
          type="button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

function StartingWorkTable({
  item,
  label,
  zoom,
}: {
  item: StartingPackageItem;
  label: string;
  zoom: FlowZoom;
}) {
  return (
    <section className="work-table-group">
      <div className="work-table-heading">
        <div>
          <span>{label}</span>
          <strong>{item.name}</strong>
        </div>
        <em>{item.initialContents.length}</em>
      </div>
      {zoom > 0 && <p className="work-table-description">{item.description}</p>}
      <table className="work-item-table">
        <tbody>
          {item.initialContents.map((content, index) => {
            const compact = compactContent(content, index);
            return (
              <tr key={content}>
                <td>{compact.marker}</td>
                <td>
                  {compact.detail ? (
                    <details
                      open={zoom === 2 ? true : undefined}
                      key={`${zoom}-${content}`}
                    >
                      <summary>
                        <span>{compact.label}</span>
                        <i aria-hidden="true">›</i>
                      </summary>
                      <p>{compact.detail}</p>
                    </details>
                  ) : (
                    <span className="work-item-label">{compact.label}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function StartingWorkPanel({
  items,
  zoom,
  disabled,
  editing,
  onEdit,
  onPropose,
  onCancel,
  onSave,
}: {
  items: StartingPackageItem[];
  zoom: FlowZoom;
  disabled: boolean;
  editing: boolean;
  onEdit: () => void;
  onPropose: () => void;
  onCancel: () => void;
  onSave: (items: StartingPackageItem[]) => void;
}) {
  const safeItems = items ?? [];
  const ordered = STARTING_WORK_ROLES.map((role) =>
    safeItems.find((item) => item.role === role),
  ).filter(Boolean) as StartingPackageItem[];
  const isComplete = ordered.length === STARTING_WORK_ROLES.length;
  const currentState = ordered.find((item) => item.role === "state");
  const frontier = ordered.find((item) => item.role === "frontier");
  const firstWork = ordered.find((item) => item.role === "first-work");

  return (
    <section className={`starting-package starting-package-level-${zoom}`}>
      <div className="starting-package-heading">
        <div>
          <span className="eyebrow">What matters first</span>
          <h3>Starting work</h3>
        </div>
        {!editing && (
          <button
            className="button-secondary"
            disabled={disabled}
            onClick={isComplete ? onEdit : onPropose}
            type="button"
          >
            {isComplete ? "Edit starting work" : "Ask agent to propose it"}
          </button>
        )}
      </div>

      {editing ? (
        <StartingPackageEditor
          disabled={disabled}
          items={safeItems}
          onCancel={onCancel}
          onSave={onSave}
          roles={STARTING_WORK_ROLES}
          saveLabel="Save starting work"
        />
      ) : isComplete ? (
        <>
          <div className="starting-work-tables">
            {currentState && (
              <StartingWorkTable item={currentState} label="Current" zoom={zoom} />
            )}
            {frontier && (
              <StartingWorkTable item={frontier} label="Next" zoom={zoom} />
            )}
          </div>
          {firstWork && (
            <section className="first-task-spotlight">
              <div>
                <span>Start here</span>
                <strong>{firstWork.name}</strong>
                {zoom > 0 && <p>{firstWork.description}</p>}
              </div>
              <details open={zoom === 2 ? true : undefined} key={`first-task-${zoom}`}>
                <summary>{firstWork.initialContents.length} task steps</summary>
                <ol>
                  {firstWork.initialContents.map((content) => (
                    <li key={content}>{content}</li>
                  ))}
                </ol>
              </details>
            </section>
          )}
          <div className="starting-package-to-loop">
            <span aria-hidden="true">↓</span>
            <strong>Begin the cycle</strong>
          </div>
        </>
      ) : (
        <div className="starting-package-missing">
          The agent has not proposed concrete starting work yet.
        </div>
      )}
    </section>
  );
}

function SetupPanel({
  items,
  zoom,
  disabled,
  editing,
  onEdit,
  onPropose,
  onCancel,
  onSave,
}: {
  items: StartingPackageItem[];
  zoom: FlowZoom;
  disabled: boolean;
  editing: boolean;
  onEdit: () => void;
  onPropose: () => void;
  onCancel: () => void;
  onSave: (items: StartingPackageItem[]) => void;
}) {
  const safeItems = items ?? [];
  const setup = safeItems.find((item) => item.role === "foundation");

  return (
    <section className="setup-panel">
      <div className="setup-panel-heading">
        <div>
          <span className="eyebrow">Specified separately</span>
          <h3>Setup</h3>
        </div>
        {!editing && (
          <button
            className="button-secondary"
            disabled={disabled}
            onClick={setup ? onEdit : onPropose}
            type="button"
          >
            {setup ? "Edit setup" : "Ask agent to specify it"}
          </button>
        )}
      </div>

      {editing ? (
        <StartingPackageEditor
          disabled={disabled}
          items={safeItems}
          onCancel={onCancel}
          onSave={onSave}
          roles={["foundation"]}
          saveLabel="Save setup"
        />
      ) : setup ? (
        <details
          className="setup-disclosure"
          open={zoom > 0 ? true : undefined}
          key={`setup-${zoom}`}
        >
          <summary>
            <span>
              <strong>{setup.name}</strong>
              <small>{setup.initialContents.length} choices ready</small>
            </span>
            <em>View</em>
          </summary>
          {zoom === 2 && <p>{setup.description}</p>}
          <table className="setup-table">
            <tbody>
              {setup.initialContents.map((content, index) => {
                const compact = compactContent(content, index);
                return (
                  <tr key={content}>
                    <td>{compact.marker}</td>
                    <td>
                      <details
                        open={zoom === 2 ? true : undefined}
                        key={`${zoom}-${content}`}
                      >
                        <summary>
                          <span>{compact.label}</span>
                          <i aria-hidden="true">›</i>
                        </summary>
                        <p>{compact.detail || content}</p>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ) : (
        <div className="starting-package-missing">
          The agent has not specified a concrete setup yet.
        </div>
      )}
    </section>
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

  return (
    <>
      <div className="flow-toolbar">
        <div>
          <h3>How the work continues</h3>
          {zoom > 0 && <p>{FLOW_ZOOM_DESCRIPTION[zoom]}</p>}
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
                      <strong>{state.name}</strong>
                      {zoom > 0 && <em>{state.summary}</em>}
                    </span>
                    {isCycleStart && (
                      <span className="flow-state-tag">
                        Repeat from here
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
            <span>Pauses and stopping rules</span>
            <small>Human decisions, limits, recovery, and acceptance</small>
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
                <strong>Before work starts</strong>
                <small>{setupStates.map((state) => state.name).join(" · ")}</small>
              </div>
            )}
            {runtimeStates.filter((state) => !setupStates.some((setup) => setup.id === state.id)).length > 0 && (
              <div>
                <strong>Other recovery steps</strong>
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
                    <span>Uses</span>
                    <ul>
                      {(focusedState.reads.length ? focusedState.reads : ["Nothing declared"]).map(
                        (item) => <li key={item}>{item}</li>,
                      )}
                    </ul>
                  </div>
                  <div className="flow-contract-outputs">
                    <span>Produces</span>
                    <ul>
                      {(focusedState.writes.length ? focusedState.writes : ["Nothing declared"]).map(
                        (item) => <li key={item}>{item}</li>,
                      )}
                    </ul>
                  </div>
                  <div className="flow-contract-instruction">
                    <span>What happens</span>
                    <p>{focusedState.instruction}</p>
                  </div>
                  <div className="flow-contract-exit">
                    <span>Ready when</span>
                    <p>{focusedState.completion}</p>
                  </div>
                  <div className="flow-contract-paths">
                    <span>What happens next</span>
                    {focusedState.transitions.length ? (
                      focusedState.transitions.map((transition) => (
                        <button
                          key={transition.id}
                          onClick={() => onFocus(transition.to)}
                          type="button"
                        >
                          <strong>{transition.when}</strong>
                          <small>
                            {transition.kind === "interrupt"
                              ? "Pause"
                              : transition.kind === "complete"
                                ? "Finish"
                                : transition.kind === "continue"
                                  ? "Repeat"
                                  : "Next"} → {describeTarget(transition)}
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
  const [constructionActivities, setConstructionActivities] = useState<
    ActivityEntry[]
  >([]);
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
  const [testActivities, setTestActivities] = useState<ActivityEntry[]>([]);
  const [agentTest, setAgentTest] = useState<AgentTestResult | null>(null);
  const [unifiedTestStage, setUnifiedTestStage] =
    useState<UnifiedTestStage>("idle");
  const [testAudit, setTestAudit] = useState<string[]>([]);
  const [humanReview, setHumanReview] =
    useState<HumanReviewRequest | null>(null);
  const [dismissedHumanReviewKey, setDismissedHumanReviewKey] =
    useState<string | null>(null);
  const [humanReviewInput, setHumanReviewInput] = useState("");
  const [isHumanReviewSubmitting, setIsHumanReviewSubmitting] = useState(false);
  const [humanReviewError, setHumanReviewError] = useState<string | null>(null);
  const [runtimeRun, setRuntimeRun] = useState<RuntimeRun | null>(null);
  const [runtimeActivity, setRuntimeActivity] = useState("Ready to start");
  const [runtimeActivities, setRuntimeActivities] = useState<ActivityEntry[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeClock, setRuntimeClock] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wiringTestRunRef = useRef(0);
  const unifiedTestRunRef = useRef(0);

  const sequence = useMemo(
    () => (loop ? primarySequence(loop) : null),
    [loop],
  );
  const findings = useMemo(() => (loop ? validateLoop(loop) : []), [loop]);
  const blockingFindings = findings.filter((item) => item.severity === "error");
  const isUnifiedTestRunning = ACTIVE_TEST_STAGES.includes(unifiedTestStage);
  const isRuntimeRunning = runtimeRun?.active === true;
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
      const [
        healthResponse,
        loopResponse,
        conversationResponse,
        testResponse,
        runResponse,
      ] = await Promise.all([
        fetch(`${DAEMON_URL}/api/health`),
        fetch(`${DAEMON_URL}/api/loop`),
        fetch(`${DAEMON_URL}/api/conversation`),
        fetch(`${DAEMON_URL}/api/test`),
        fetch(`${DAEMON_URL}/api/run`),
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
      if (runResponse.ok) {
        const payload = (await runResponse.json()) as {
          run: RuntimeRun | null;
        };
        setRuntimeRun(payload.run);
        setRuntimeActivities(payload.run?.activities ?? []);
      }
    } catch {
      setActivity("Local bridge is offline");
    }
  }, [applyConversationPayload]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isRuntimeRunning) return;
    setRuntimeClock(Date.now());
    const timer = window.setInterval(() => setRuntimeClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRuntimeRunning, runtimeRun?.id]);

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

  useEffect(() => {
    if (
      !loop ||
      !agentTest ||
      agentTest.loopRevision !== loop.revision ||
      agentTest.verdict === "pass" ||
      humanReview ||
      ACTIVE_TEST_STAGES.includes(unifiedTestStage)
    ) {
      return;
    }
    const request = extractHumanReview(
      agentTest.report,
      null,
      loop.revision,
    );
    if (!request || request.key === dismissedHumanReviewKey) return;
    setHumanReview(request);
    setHumanReviewInput("");
    setHumanReviewError(null);
  }, [
    agentTest,
    dismissedHumanReviewKey,
    humanReview,
    loop,
    unifiedTestStage,
  ]);

  const rememberUiMessage = (role: "loopit" | "error", text: string) => {
    void fetch(`${DAEMON_URL}/api/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, text }),
    });
  };

  const startNewConversation = async () => {
    if (isWorking || isAgentTesting || isRuntimeRunning || isConversationChanging) return;
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
      isRuntimeRunning ||
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
  ): Promise<string | null> => {
    const text = (textOverride ?? input).trim();
    if (
      !text ||
      isWorking ||
      isRuntimeRunning ||
      (isAgentTesting && !allowDuringTest)
    ) return null;

    const selectedAgent = health?.agents[agent];
    if (selectedAgent && !selectedAgent.installed) {
      setMessages((current) => [
        ...current,
        newMessage("error", `${agent} is not installed on this machine.`),
      ]);
      return null;
    }

    setMessages((current) => [
      ...current,
      newMessage("user", displayText ?? text),
    ]);
    setInput("");
    setIsWorking(true);
    setActivity(`Starting ${agent === "codex" ? "Codex" : "Claude"}`);
    setConstructionActivities([]);
    let finalAgentText: string | null = null;

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
            setConstructionActivities((current) =>
              appendActivity(current, event),
            );
          }
          if (event.type === "agent_message") {
            finalAgentText = event.text;
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
    return finalAgentText;
  };

  const persistLoop = async (
    nextLoop: LoopDefinition,
    note: string,
  ): Promise<LoopDefinition | null> => {
    if (isSaving || isWorking || isAgentTesting || isRuntimeRunning) return null;
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
  const currentAgentTest =
    agentTest && agentTest.loopRevision === loop?.revision ? agentTest : null;
  const currentStructurePasses =
    Boolean(sequence?.loopBack) &&
    blockingFindings.length === 0 &&
    wiringTestSteps.length === expectedTransitionCount;
  const pendingHumanReview =
    currentAgentTest && currentAgentTest.verdict !== "pass" && loop
      ? extractHumanReview(
          currentAgentTest.report,
          null,
          loop.revision,
        )
      : null;
  const testPassed =
    currentAgentTest?.verdict === "pass" && currentStructurePasses;
  const canStartRuntime = testPassed && health?.runtimeAllowed === true;
  const runtimeStartedAt = runtimeRun?.startedAt
    ? Date.parse(runtimeRun.startedAt)
    : 0;
  const runtimeFinishedAt = runtimeRun?.finishedAt
    ? Date.parse(runtimeRun.finishedAt)
    : runtimeStartedAt;
  const runtimeElapsed = runtimeRun
    ? Math.max(
        0,
        (isRuntimeRunning
          ? runtimeClock || runtimeStartedAt
          : runtimeFinishedAt) - runtimeStartedAt,
      )
    : 0;
  const testPanelLabel = isUnifiedTestRunning
    ? TEST_STAGE_LABEL[unifiedTestStage]
    : testPassed
      ? "Passed"
      : pendingHumanReview || currentAgentTest?.verdict === "risk"
        ? "Needs input"
        : currentAgentTest?.verdict === "fail"
          ? "Needs repair"
          : unifiedTestStage === "needs-attention"
            ? "Needs input"
            : "Not tested";
  const testPanelTone =
    testPanelLabel === "Passed"
      ? "passed"
      : testPanelLabel === "Not tested"
        ? "idle"
        : isUnifiedTestRunning
          ? "running"
          : "failed";
  const traceTone: TestPathTone =
    unifiedTestStage === "tracing" || wiringTestStatus === "running"
      ? "active"
      : wiringTestStatus === "passed" ||
          (currentAgentTest && currentStructurePasses)
        ? "complete"
        : wiringTestStatus === "failed" ||
            (currentAgentTest && !currentStructurePasses)
          ? "action"
          : "pending";
  const rehearsalTone: TestPathTone =
    unifiedTestStage === "rehearsing" ||
    (unifiedTestStage === "retesting" && isAgentTesting)
      ? "active"
      : currentAgentTest?.verdict === "pass"
        ? "complete"
        : currentAgentTest
          ? "action"
          : "pending";
  const resolutionTone: TestPathTone = testPassed
    ? "complete"
    : unifiedTestStage === "repairing" || unifiedTestStage === "retesting"
      ? "active"
      : currentAgentTest || unifiedTestStage === "needs-attention"
        ? "action"
        : "pending";
  const testPathSteps: Array<{
    label: string;
    detail: string;
    tone: TestPathTone;
  }> = [
    {
      label: "Trace every path",
      detail:
        traceTone === "active"
          ? "Checking every transition"
          : traceTone === "complete"
            ? `${expectedTransitionCount} transitions close the cycle`
            : traceTone === "action"
              ? "Control flow must be repaired"
              : "Check every transition and loop-back",
      tone: traceTone,
    },
    {
      label: "Test with a fresh agent",
      detail:
        rehearsalTone === "active"
          ? agentTestActivity
          : rehearsalTone === "complete"
            ? "A fresh agent can continue from the files"
            : rehearsalTone === "action"
              ? "The rehearsal found issues to resolve"
              : "Challenge handoffs and edge cases",
      tone: rehearsalTone,
    },
    {
      label: "Fix or ask you",
      detail:
        resolutionTone === "active"
          ? "Repairing, then testing again"
          : resolutionTone === "complete"
            ? "No unresolved construction issues"
            : pendingHumanReview
              ? "One human decision remains"
              : currentAgentTest
                ? "Continue automatic repair"
                : "Repair findings or request one decision",
      tone: resolutionTone,
    },
    {
      label: "Passed",
      detail: testPassed
        ? `Revision ${loop?.revision} is ready for sandbox use`
        : "Reached after all earlier checks pass",
      tone: testPassed ? "complete" : "pending",
    },
  ];

  const runWiringTest = async (
    targetLoop: LoopDefinition = loop!,
    recordConversation = true,
  ): Promise<boolean> => {
    if (!targetLoop || wiringTestStatus === "running") return false;
    const targetSequence = primarySequence(targetLoop);
    const targetFindings = validateLoop(targetLoop);
    const targetOtherTransitions = targetLoop.states.flatMap((state) =>
      state.transitions
        .filter(
          (transition) =>
            !targetSequence.chosenTransitionIds.has(transition.id),
        )
        .map((transition) => ({ state, transition })),
    );
    const targetSteps: WiringTestStep[] = [
      ...targetSequence.links.map((link) => ({
        ...link,
        lane: "usual" as const,
      })),
      ...(targetSequence.loopBack
        ? [{ ...targetSequence.loopBack, lane: "repeat" as const }]
        : []),
      ...targetOtherTransitions.map(({ state, transition }) => ({
        sourceId: state.id,
        targetId: transition.to,
        transition,
        lane: "edge" as const,
      })),
    ];
    const targetTransitionCount = targetLoop.states.reduce(
      (total, state) => total + state.transitions.length,
      0,
    );
    const runId = wiringTestRunRef.current + 1;
    wiringTestRunRef.current = runId;
    setWiringTestStatus("running");
    setWiringTestIndex(-1);
    setTestedTransitionIds([]);

    for (let index = 0; index < targetSteps.length; index += 1) {
      if (wiringTestRunRef.current !== runId) return false;
      setWiringTestIndex(index);
      await new Promise((resolve) => window.setTimeout(resolve, 480));
      if (wiringTestRunRef.current !== runId) return false;
      setTestedTransitionIds((current) => [
        ...current,
        targetSteps[index].transition.id,
      ]);
    }

    setWiringTestIndex(-1);
    const passed =
      Boolean(targetSequence.loopBack) &&
      targetFindings.every((finding) => finding.severity !== "error") &&
      targetSteps.length === targetTransitionCount;
    setWiringTestStatus(passed ? "passed" : "failed");

    const summary = passed
      ? `Quick wiring test passed for loop revision ${targetLoop.revision}: the recurrence closed and all ${targetTransitionCount} declared transitions were traced.`
      : `Quick wiring test found a problem in loop revision ${targetLoop.revision}. The loop did not close cleanly or not every declared transition could be traced.`;
    if (recordConversation) {
      setMessages((current) => [...current, newMessage("loopit", summary)]);
      rememberUiMessage("loopit", summary);
    }
    return passed;
  };

  const runAgentRehearsal = async (): Promise<AgentTestResult | null> => {
    if (!loop || isWorking || isAgentTesting || isRuntimeRunning) return null;
    setIsAgentTesting(true);
    setAgentTestActivity(
      `Starting a fresh, read-only ${agent === "codex" ? "Codex" : "Claude"} rehearsal`,
    );
    setTestActivities([]);

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
            setTestActivities((current) => appendActivity(current, event));
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

      return resultForResolution;
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "The agent rehearsal failed.";
      setMessages((current) => [...current, newMessage("error", text)]);
      rememberUiMessage("error", text);
      setAgentTestActivity("Rehearsal unavailable");
      return null;
    } finally {
      setIsAgentTesting(false);
      void refresh();
    }
  };

  const stopUnifiedTest = async () => {
    unifiedTestRunRef.current += 1;
    wiringTestRunRef.current += 1;
    setWiringTestStatus("idle");
    setWiringTestIndex(-1);
    await interrupt();
    setUnifiedTestStage("needs-attention");
  };

  const runUnifiedTest = async (
    startingLoop: LoopDefinition | null = loop,
  ) => {
    if (
      !startingLoop ||
      isWorking ||
      isAgentTesting ||
      isRuntimeRunning ||
      isUnifiedTestRunning
    ) return;
    const runId = unifiedTestRunRef.current + 1;
    unifiedTestRunRef.current = runId;
    const appendAudit = (...items: string[]) =>
      setTestAudit((current) => [...current, ...items]);

    setTestAudit([]);
    setHumanReview(null);
    setAgentTest(null);
    setUnifiedTestStage("tracing");

    try {
      let testedLoop = startingLoop;
      let tracePassed = await runWiringTest(testedLoop, false);
      if (unifiedTestRunRef.current !== runId) return;
      appendAudit(
        tracePassed
          ? `Revision ${testedLoop.revision}: every declared transition was traced and the cycle closes.`
          : `Revision ${testedLoop.revision}: the control-flow trace found a structural problem.`,
      );

      let result: AgentTestResult | null = null;
      if (tracePassed) {
        setUnifiedTestStage("rehearsing");
        result = await runAgentRehearsal();
        if (unifiedTestRunRef.current !== runId) return;
        if (!result) {
          appendAudit("The fresh-agent rehearsal did not produce a report.");
          setUnifiedTestStage("needs-attention");
          return;
        }
        appendAudit(
          `Revision ${testedLoop.revision}: fresh-agent rehearsal returned ${result.verdict.toUpperCase()}.`,
        );
        if (result.verdict === "pass") {
          setUnifiedTestStage("passed");
          return;
        }
      } else {
        appendAudit(
          ...validateLoop(testedLoop)
            .filter((finding) => finding.severity === "error")
            .map((finding) => `${finding.title}: ${finding.detail}`),
        );
      }

      setUnifiedTestStage("repairing");
      const exactTraceFindings = validateLoop(testedLoop)
        .filter((finding) => finding.severity === "error")
        .map((finding) => `- ${finding.id}: ${finding.detail}`)
        .join("\n");
      const repairPrompt = tracePassed
        ? RESOLVE_TEST_FAILURE
        : `The deterministic control-flow trace failed for loop revision ${testedLoop.revision}. This is a machine-owned repair; do not ask the human to choose parser fields, state kinds, transition kinds, or validator wording.

Read .loopit/loop.md and make one smallest coherent update that resolves every exact finding below. Do not inspect unrelated project files and do not change the user's objective.

${exactTraceFindings}`;
      await sendMessage(
        repairPrompt,
        "Fix issues found by the loop test",
        true,
      );
      if (unifiedTestRunRef.current !== runId) return;

      const loopResponse = await fetch(`${DAEMON_URL}/api/loop`);
      if (!loopResponse.ok) {
        throw new Error("The repaired loop could not be loaded.");
      }
      const payload = (await loopResponse.json()) as {
        loop: LoopDefinition | null;
      };
      const repairedLoop = payload.loop;
      if (!repairedLoop) throw new Error("The repair removed the loop.");

      if (repairedLoop.revision === testedLoop.revision) {
        appendAudit(
          "The single automatic patch made no durable change. Loopit stopped instead of repeating an uncontrolled repair cycle.",
        );
        const review = result
          ? extractHumanReview(
              result.report,
              null,
              testedLoop.revision,
            )
          : null;
        if (review) {
          setHumanReview(review);
          setHumanReviewInput("");
          setHumanReviewError(null);
        }
        setUnifiedTestStage("needs-attention");
        return;
      }

      appendAudit(
        `Automatic repair created revision ${repairedLoop.revision}.`,
        ...summarizeLoopChanges(testedLoop, repairedLoop),
      );
      testedLoop = repairedLoop;
      setLoop(repairedLoop);
      setParseError(null);
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      if (unifiedTestRunRef.current !== runId) return;

      setUnifiedTestStage("retesting");
      tracePassed = await runWiringTest(testedLoop, false);
      if (unifiedTestRunRef.current !== runId) return;
      appendAudit(
        tracePassed
          ? `Revision ${testedLoop.revision}: repaired control flow passes.`
          : `Revision ${testedLoop.revision}: control flow still has ${
              validateLoop(testedLoop).filter(
                (finding) => finding.severity === "error",
              ).length
            } blocking findings.`,
      );
      if (!tracePassed) {
        appendAudit(
          "Loopit stopped after one automatic patch. The remaining validator findings are listed above; no parser choice was sent to human review.",
        );
        setUnifiedTestStage("needs-attention");
        return;
      }

      result = await runAgentRehearsal();
      if (unifiedTestRunRef.current !== runId) return;
      if (!result) {
        appendAudit("The final rehearsal did not produce a report.");
        setUnifiedTestStage("needs-attention");
        return;
      }
      appendAudit(
        `Revision ${testedLoop.revision}: final fresh-agent rehearsal returned ${result.verdict.toUpperCase()}.`,
      );
      if (result.verdict === "pass") {
        setUnifiedTestStage("passed");
        return;
      }

      appendAudit(
        "Loopit stopped after one automatic patch. It will not keep creating revisions without a new diagnosis.",
      );
      const review = extractHumanReview(
        result.report,
        null,
        testedLoop.revision,
      );
      if (review) {
        setHumanReview(review);
        setHumanReviewInput("");
        setHumanReviewError(null);
      }
      setUnifiedTestStage("needs-attention");
    } catch (error) {
      appendAudit(
        error instanceof Error ? error.message : "The loop test could not finish.",
      );
      setUnifiedTestStage("needs-attention");
    }
  };

  const dismissHumanReview = () => {
    if (!humanReview) return;
    setDismissedHumanReviewKey(humanReview.key);
    setHumanReview(null);
    setHumanReviewInput("");
    setHumanReviewError(null);
  };

  const openHumanReview = () => {
    if (!pendingHumanReview) return;
    setDismissedHumanReviewKey(null);
    setHumanReview(pendingHumanReview);
    setHumanReviewInput("");
    setHumanReviewError(null);
  };

  const submitHumanReview = async (decision: string) => {
    const value = decision.trim();
    if (!humanReview || !value || isHumanReviewSubmitting) return;
    setIsHumanReviewSubmitting(true);
    setHumanReviewError(null);
    const reviewedRevision = humanReview.loopRevision;

    try {
      await sendMessage(
        `The user has resolved the human review for loop revision ${reviewedRevision}. Their decision is: ${value}\n\nRecord this decision durably in .loopit/loop.md wherever it governs scope, authority, boundaries, setup, or transitions. Preserve unrelated intent, increment the revision, and explain the change concisely. Do not merely acknowledge it in chat.`,
        `Decision: ${value}`,
        true,
      );
      const response = await fetch(`${DAEMON_URL}/api/loop`);
      if (!response.ok) throw new Error("The updated loop could not be loaded.");
      const payload = (await response.json()) as {
        loop: LoopDefinition | null;
      };
      const revisedLoop = payload.loop;
      if (!revisedLoop || revisedLoop.revision === reviewedRevision) {
        throw new Error(
          "The decision was not recorded in the loop. Review the agent response and try again.",
        );
      }

      setDismissedHumanReviewKey(humanReview.key);
      setHumanReview(null);
      setHumanReviewInput("");
      setLoop(revisedLoop);
      setParseError(null);
      setIsHumanReviewSubmitting(false);
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      await runUnifiedTest(revisedLoop);
    } catch (error) {
      setHumanReviewError(
        error instanceof Error
          ? error.message
          : "The decision could not be recorded.",
      );
    } finally {
      setIsHumanReviewSubmitting(false);
    }
  };

  const startRuntime = async () => {
    if (
      !loop ||
      !canStartRuntime ||
      isRuntimeRunning ||
      isWorking ||
      isAgentTesting
    ) {
      return;
    }
    setRuntimeError(null);
    setRuntimeActivity("Starting the first loop worker");
    setRuntimeActivities([]);

    try {
      const response = await fetch(`${DAEMON_URL}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "The loop worker did not start.");
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
          if (event.type === "activity") {
            setRuntimeActivity(event.text);
            setRuntimeActivities((current) => appendActivity(current, event));
          }
          if (event.type === "run_started" || event.type === "run_updated") {
            setRuntimeRun(event.run as RuntimeRun);
            if (Array.isArray(event.run.activities)) {
              setRuntimeActivities(event.run.activities as ActivityEntry[]);
            }
          }
          if (event.type === "agent_message") {
            setRuntimeActivity("Worker report saved");
          }
          if (event.type === "error") {
            setRuntimeError(event.text);
          }
        }
      }
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : "The loop worker failed.",
      );
    } finally {
      await refresh();
    }
  };

  const stopRuntime = async () => {
    setRuntimeActivity("Stopping the loop worker");
    await interrupt();
    await refresh();
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
        <div
          className={`connection-status ${
            health?.runtimeAllowed === false ? "is-protected" : ""
          }`}
          title={health?.projectRoot}
        >
          <span className={health?.ok ? "status-dot is-online" : "status-dot"} />
          <div>
            <small>Target project</small>
            <strong>{health?.ok ? health.projectName : "Connecting…"}</strong>
            {health?.ok && <span>{health.projectRoot}</span>}
          </div>
          {health?.runtimeAllowed === false && <i>Runtime protected</i>}
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
                  disabled={isWorking || isAgentTesting || isRuntimeRunning || isConversationChanging}
                  onClick={() => void startNewConversation()}
                  type="button"
                >
                  + New
                </button>
                <button
                  aria-expanded={isHistoryOpen}
                  disabled={isWorking || isAgentTesting || isRuntimeRunning}
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
              <div className="agent-activity-card">
                <div className="agent-activity">
                  <span className="pulse-dot" />
                  <strong>{activity}</strong>
                </div>
                <ActivityFeed
                  entries={constructionActivities}
                  label="Construction agent activity"
                />
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
              disabled={isRuntimeRunning}
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
                  disabled={!input.trim() || isRuntimeRunning}
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
          {humanReview && loop && (
            <div className="human-review-overlay">
              <section
                aria-labelledby="human-review-title"
                aria-modal="true"
                className="human-review-dialog"
                role="dialog"
              >
                <header>
                  <div>
                    <span className="eyebrow">Human review</span>
                    <h2 id="human-review-title">Your decision is needed</h2>
                  </div>
                  <button
                    aria-label="Review later"
                    disabled={isHumanReviewSubmitting}
                    onClick={dismissHumanReview}
                    type="button"
                  >
                    ×
                  </button>
                </header>

                <div className="human-review-context">
                  <span>Why this appeared</span>
                  <p>{humanReview.context}</p>
                </div>

                <div className="human-review-question">
                  <span>Decision</span>
                  <strong>{humanReview.question}</strong>
                </div>

                <div className="human-review-recommendation">
                  <span>Recommended next step</span>
                  <p>{humanReview.recommendation}</p>
                  <small>{humanReview.whyHuman}</small>
                </div>

                {humanReview.options.length > 0 && (
                  <div className="human-review-options">
                    <span>Choose an option</span>
                    {humanReview.options.map((option) => (
                      <button
                        disabled={isHumanReviewSubmitting}
                        key={option}
                        onClick={() => void submitHumanReview(option)}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                <label className="human-review-custom">
                  Or give your own direction
                  <textarea
                    disabled={isHumanReviewSubmitting}
                    onChange={(event) => setHumanReviewInput(event.target.value)}
                    placeholder="Explain the decision the agent should follow…"
                    rows={3}
                    value={humanReviewInput}
                  />
                </label>

                {humanReviewError && (
                  <p className="human-review-error">{humanReviewError}</p>
                )}

                <footer>
                  <button
                    className="button-secondary"
                    disabled={isHumanReviewSubmitting}
                    onClick={dismissHumanReview}
                    type="button"
                  >
                    Review later
                  </button>
                  {humanReview.recommendedDecision && (
                    <button
                      className="button-secondary"
                      disabled={isHumanReviewSubmitting}
                      onClick={() =>
                        void submitHumanReview(
                          humanReview.recommendedDecision!,
                        )
                      }
                      type="button"
                    >
                      Use recommendation
                    </button>
                  )}
                  <button
                    className="button-primary"
                    disabled={
                      isHumanReviewSubmitting || !humanReviewInput.trim()
                    }
                    onClick={() => void submitHumanReview(humanReviewInput)}
                    type="button"
                  >
                    {isHumanReviewSubmitting
                      ? "Recording decision…"
                      : "Send decision"}
                  </button>
                </footer>
              </section>
            </div>
          )}

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
                    disabled={isSaving || isWorking || isAgentTesting || isRuntimeRunning || isUnifiedTestRunning}
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
                <StartingWorkPanel
                  disabled={isSaving || isWorking || isAgentTesting || isRuntimeRunning || isUnifiedTestRunning}
                  editing={editing === "starting-work"}
                  items={loop.startingPackage}
                  onCancel={() => setEditing(null)}
                  onEdit={() => {
                    setFlowZoom(2);
                    setEditing("starting-work");
                  }}
                  onPropose={() =>
                    void sendMessage(
                      "Complete the starting work and setup for this existing loop. The starting work must list the concrete items the user cares about—such as specific features, hypotheses with initial support status, design questions, opportunities, or cases—and select one fully specified first task. Put tools, infrastructure, experimental design, baselines, models, data, metrics, and other setup choices in the foundation item instead. Inspect what already exists and make safe, reversible setup choices yourself; ask only about cost, authority, risk, or a materially different direction.",
                      "Ask the agent to propose concrete starting work",
                    )
                  }
                  onSave={(items) =>
                    void persistLoop(
                      {
                        ...loop,
                        startingPackage: mergeStartingPackage(
                          loop.startingPackage,
                          items,
                        ),
                      },
                      "Updated the starting work.",
                    )
                  }
                  zoom={flowZoom}
                />

                <StateFlowCanvas
                  currentWiringStep={currentWiringStep}
                  disabled={isSaving || isWorking || isAgentTesting || isRuntimeRunning || isUnifiedTestRunning}
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

                <SetupPanel
                  disabled={isSaving || isWorking || isAgentTesting || isRuntimeRunning || isUnifiedTestRunning}
                  editing={editing === "setup"}
                  items={loop.startingPackage}
                  onCancel={() => setEditing(null)}
                  onEdit={() => {
                    setFlowZoom(2);
                    setEditing("setup");
                  }}
                  onPropose={() =>
                    void sendMessage(
                      "Specify the concrete setup required before this loop's first task. Inspect the workspace and choose safe, reversible defaults rather than leaving placeholders. For research, name the initial method, data, baseline, evaluation metric, minimal experiment, and concrete model family and size when relevant. For software, name the actual stack, repository conventions, test command, fixtures, and local services. For design or business work, name the real tools, materials, data, participants or channels, metrics, and decision limits. Ask me only for cost, authority, risk, private information, or a materially different direction.",
                      "Ask the agent to specify the setup",
                    )
                  }
                  onSave={(items) =>
                    void persistLoop(
                      {
                        ...loop,
                        startingPackage: mergeStartingPackage(
                          loop.startingPackage,
                          items,
                        ),
                      },
                      "Updated the setup.",
                    )
                  }
                  zoom={flowZoom}
                />

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

                <section className={`test-lab flow-test-lab loop-test-section is-${testPanelTone}`}>
                  <header className="loop-test-heading">
                    <div>
                      <span className="eyebrow">Required before runtime</span>
                      <strong>Test this loop</strong>
                    </div>
                    <span>{testPanelLabel}</span>
                  </header>

                  <div className="flow-test-content">
                    <div className="test-lab-heading">
                      <p>
                        One path to a final result: check, repair or decide,
                        retest, then pass the current revision.
                      </p>
                      <div className="test-lab-actions">
                        {isUnifiedTestRunning ? (
                          <button
                            className="button-stop"
                            onClick={() => void stopUnifiedTest()}
                            type="button"
                          >
                            Stop test
                          </button>
                        ) : (
                          <button
                            className="button-primary"
                            disabled={isWorking || isAgentTesting || isRuntimeRunning}
                            onClick={() =>
                              pendingHumanReview
                                ? openHumanReview()
                                : void runUnifiedTest()
                            }
                            type="button"
                          >
                            {testPanelLabel === "Passed"
                              ? "Test again"
                              : pendingHumanReview
                                ? "Review decision"
                                : currentAgentTest
                                  ? "Continue test"
                                  : "Start test"}
                          </button>
                        )}
                      </div>
                    </div>

                    <ol
                      aria-label="Path to a passed loop test"
                      className="test-path"
                    >
                      {testPathSteps.map((step, index) => (
                        <li className={`is-${step.tone}`} key={step.label}>
                          <span aria-hidden="true">
                            {step.tone === "complete"
                              ? "✓"
                              : step.tone === "active"
                                ? "…"
                                : step.tone === "action"
                                  ? "!"
                                  : index + 1}
                          </span>
                          <div>
                            <strong>{step.label}</strong>
                            <small>{step.detail}</small>
                          </div>
                        </li>
                      ))}
                    </ol>

                    {!isUnifiedTestRunning && testPassed && (
                      <div className="test-completion is-passed">
                        <span aria-hidden="true">✓</span>
                        <div>
                          <strong>Loop test passed</strong>
                          <p>
                            Revision {loop.revision} completed every construction
                            check. It is ready for implementation in a sandbox.
                          </p>
                        </div>
                      </div>
                    )}

                    {!isUnifiedTestRunning && !testPassed && pendingHumanReview && (
                      <div className="test-completion is-blocked">
                        <span aria-hidden="true">!</span>
                        <div>
                          <strong>One decision keeps this test from passing</strong>
                          <p>
                            Review the proposed choice; Loopit records it and
                            resumes the test automatically.
                          </p>
                        </div>
                        <button
                          className="button-primary"
                          onClick={openHumanReview}
                          type="button"
                        >
                          Review decision
                        </button>
                      </div>
                    )}

                    {!isUnifiedTestRunning &&
                      !testPassed &&
                      currentAgentTest &&
                      !pendingHumanReview && (
                        <div className="test-completion is-blocked">
                          <span aria-hidden="true">!</span>
                          <div>
                            <strong>The test is not finished yet</strong>
                            <p>
                              Continue the test to repair the remaining findings
                              and run every check again.
                            </p>
                          </div>
                        </div>
                      )}

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
                        <ActivityFeed
                          entries={testActivities}
                          label="Loop test activity"
                        />
                      </div>
                    )}

                    {unifiedTestStage === "repairing" && (
                      <div className="agent-test-running is-resolution">
                        <span className="pulse-dot" />
                        <div>
                          <strong>Fixing the loop</strong>
                          <p>
                            Agent-owned issues are being repaired before the
                            next test.
                          </p>
                        </div>
                      </div>
                    )}

                    {unifiedTestStage === "retesting" && !isAgentTesting && (
                      <div className="test-next-action">
                        <span aria-hidden="true">→</span>
                        <div>
                          <strong>Checking the repaired revision</strong>
                          <p>The complete test is running again automatically.</p>
                        </div>
                      </div>
                    )}

                    {testAudit.length > 0 && !isUnifiedTestRunning && (
                      <details className="test-audit">
                        <summary>
                          <strong>What was checked or changed</strong>
                          <span>{testAudit.length} audit entries</span>
                        </summary>
                        <ol>
                          {testAudit.map((entry, index) => (
                            <li key={`${index}-${entry}`}>{entry}</li>
                          ))}
                        </ol>
                      </details>
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
                </section>

              <section
                className={`runtime-launch ${
                  isRuntimeRunning
                    ? "is-running"
                    : canStartRuntime
                      ? "is-ready"
                      : "is-locked"
                }`}
              >
                <header>
                  <div>
                    <span className="eyebrow">Runtime</span>
                    <h3>Start the loop</h3>
                  </div>
                  <div className="runtime-header-state">
                    <div className="runtime-clock">
                      <small>
                        {runtimeRun && !isRuntimeRunning
                          ? "Last continuous run"
                          : "Continuous runtime"}
                      </small>
                      <time
                        dateTime={`PT${Math.floor(runtimeElapsed / 1000)}S`}
                      >
                        {formatRuntimeDuration(runtimeElapsed)}
                      </time>
                    </div>
                    <span>
                      {isRuntimeRunning ? "Running" : canStartRuntime ? "Ready" : "Locked"}
                    </span>
                  </div>
                </header>
                <div className="runtime-launch-body">
                  <div>
                    <strong>
                      {isRuntimeRunning
                        ? runtimeActivity
                        : health?.ok !== true
                          ? "Confirm the target project"
                          : health.runtimeAllowed === false
                          ? "Choose a separate target project"
                          : testPassed
                          ? "The current revision passed and can run"
                          : `Pass Test this loop for revision ${loop.revision} first`}
                    </strong>
                    <p>
                      {isRuntimeRunning
                        ? "A separate local worker is following the tested loop and writing durable project artifacts."
                        : health?.ok !== true
                          ? "Runtime stays locked until the local daemon identifies the repository the agent will modify."
                          : health.runtimeAllowed === false
                          ? "The Loopit source tree is protected. Stop Loopit, open the separate repository the agent should modify, and launch Loopit from there."
                          : testPassed
                          ? `Start a separate ${agent === "codex" ? "Codex" : "Claude"} worker from the declared first task and state.`
                          : "Runtime stays locked until the current revision passes every construction check."}
                    </p>
                  </div>
                  {isRuntimeRunning ? (
                    <button
                      className="button-stop"
                      onClick={() => void stopRuntime()}
                      type="button"
                    >
                      Stop loop
                    </button>
                  ) : (
                    <button
                      className="button-primary button-large"
                      disabled={
                        !canStartRuntime ||
                        isWorking ||
                        isAgentTesting ||
                        isUnifiedTestRunning
                      }
                      onClick={() => void startRuntime()}
                      type="button"
                    >
                      Start loop
                    </button>
                  )}
                </div>
                {runtimeActivities.length > 0 && (
                  <div className="runtime-activity-monitor">
                    <div>
                      <strong>
                        {isRuntimeRunning ? "Live agent activity" : "Last run activity"}
                      </strong>
                      <span>
                        {isRuntimeRunning
                          ? "Updates directly from the local agent"
                          : `${runtimeActivities.length} recorded events`}
                      </span>
                    </div>
                    <ActivityFeed
                      entries={runtimeActivities}
                      label="Runtime agent activity"
                    />
                  </div>
                )}
                {runtimeError && <p className="runtime-error">{runtimeError}</p>}
                {runtimeRun && runtimeRun.status !== "running" && (
                  <details className="runtime-last-run">
                    <summary>
                      Last worker turn · {runtimeRun.status}
                      {runtimeRun.loopRevision !== loop.revision && " · older revision"}
                    </summary>
                    <p>{runtimeRun.summary}</p>
                  </details>
                )}
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
