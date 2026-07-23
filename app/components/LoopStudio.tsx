"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  buildRuntimeMap,
  runtimeRegionLabel,
  type RuntimeMapRegion,
} from "@/lib/runtime-map";
import {
  extractHumanReview,
  type HumanReviewRequest,
} from "@/lib/human-review";

const DAEMON_URL = "http://127.0.0.1:4318";
const MAX_AUTOMATIC_REPAIRS = 3;
const START_CONSTRUCTION =
  "Begin repository-first loop construction. No loop exists yet. Inspect the repository before asking me to describe it. If meaningful project content exists, explain your understanding of what this repository is building or doing, its current state, the concrete work that appears to matter next, and the recognizable recurring workflow you propose. Ask me to confirm or correct that understanding, and do not generate loop.md until I confirm it. If the repository is empty, ask one focused question about what I want to create or keep progressing.";
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
  output: string | null;
  kind: string;
  status: "active" | "complete" | "error";
}

interface RuntimeRun {
  id: string;
  loopRevision: number | null;
  agent: AgentName;
  active: boolean;
  status: "running" | "paused" | "completed" | "failed" | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  currentIteration?: number | null;
  iterations?: RuntimeIteration[];
  summary: string;
  activities?: ActivityEntry[];
}

interface RuntimeIteration {
  number: number;
  outcome: "continue" | "pause" | "complete";
  state: string;
  completed: string;
  next: string;
  reason: string;
  startedAt: string | null;
  finishedAt: string | null;
  reportPath?: string;
  stateVersion?: number;
  progress?: "advanced" | "learned" | "neutral" | "regressed";
}

interface RuntimeProgressIteration extends RuntimeIteration {
  runId: string;
  runNumber: number;
}

interface RuntimeStateItem {
  id: string;
  kind: "artifact" | "belief" | "failure" | "uncertainty";
  name: string;
  status: string;
  summary: string;
  evidence: string[];
}

interface RuntimeFrontierItem {
  id: string;
  title: string;
  status: "ready" | "active" | "waiting" | "retired";
  priority: number;
  objectiveLink: string;
  causedBy: string;
  retirementEvidence: string;
}

interface RuntimeDecision {
  id: string;
  question: string;
  status: "waiting" | "resolved" | "deferred";
  context: string;
  recommendation: string;
}

interface RuntimeState {
  version: number;
  loopRevision: number;
  updatedAt: string;
  status: string;
  autonomy: {
    mode: "guided" | "unattended";
    runUntil: string | null;
    maxIterations: number | null;
  };
  direction: {
    northStar: string;
    currentDirection: string;
    currentObjective: string;
    better: string[];
    hardRequirements: string[];
    flexibleRequirements: string[];
  };
  items: RuntimeStateItem[];
  frontier: RuntimeFrontierItem[];
  decisions: RuntimeDecision[];
  activeAssignment: {
    id: string;
    frontierId: string;
    title: string;
    objective: string;
    status: string;
    startedAt: string;
    reportPath: string;
  } | null;
}

interface RuntimeLedgerEntry {
  number: number;
  title: string;
  id: string;
  runId: string;
  loopRevision: number | null;
  assignmentId: string;
  outcome: "continue" | "pause" | "complete";
  progress: "advanced" | "learned" | "neutral" | "regressed";
  startedAt: string | null;
  finishedAt: string | null;
  fromVersion: number | null;
  toVersion: number | null;
  reportPath: string;
  completed: string;
  next: string;
  reason: string;
  stateChanges: string[];
  frontierChanges: string[];
  relaxations: string[];
}

interface RuntimeSteering {
  id: string;
  createdAt: string;
  status: "pending" | "applied";
  appliedStateVersion: number | null;
  directive: string;
}

interface RuntimeSnapshot {
  state: RuntimeState | null;
  ledger: RuntimeLedgerEntry[];
  steering: RuntimeSteering[];
  review: {
    lastReviewedLedger: number;
    reviewedAt: string | null;
  };
  loopRevision: number | null;
  presence: RuntimePresence | null;
}

interface RuntimePresence {
  actor: "worker" | "supervisor";
  status:
    | "working"
    | "integrating"
    | "moving"
    | "paused"
    | "completed"
    | "problem";
  assignmentId: string;
  assignmentTitle: string;
  regionId: string;
  phaseId: string | null;
  phaseName: string;
  currentAction: string;
  detail?: string | null;
  iterationNumber: number;
  source: "worker" | "inferred" | "runtime";
  updatedAt: string;
}

interface RuntimeUnderstandingMessage {
  id: string;
  role: "user" | "agent" | "steering" | "error";
  text: string;
}

interface WiringTestStep {
  sourceId: string;
  targetId: string;
  transition: LoopTransition;
  lane: "usual" | "repeat" | "edge";
}

type WiringTestStatus = "idle" | "running" | "passed" | "failed";
type TestPathTone = "pending" | "active" | "complete" | "action";
type WorkspaceMode = "design" | "runtime";
type RuntimeView = "now" | "state" | "frontier" | "history";
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

function loopContentSignature(loop: LoopDefinition) {
  return JSON.stringify({ ...loop, revision: 0 });
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
    output: typeof event.output === "string" ? event.output : null,
    kind: typeof event.kind === "string" ? event.kind : "activity",
    status:
      event.status === "complete"
        ? "complete"
        : event.status === "error"
          ? "error"
          : "active",
  };
}

function appendActivity(
  current: ActivityEntry[],
  event: Record<string, unknown>,
) {
  const next = activityEntry(event);
  return [...current.filter((entry) => entry.id !== next.id), next].slice(-100);
}

function upsertRuntimeRun(current: RuntimeRun[], next: RuntimeRun) {
  return [next, ...current.filter((run) => run.id !== next.id)].sort((left, right) =>
    String(right.startedAt ?? right.id).localeCompare(
      String(left.startedAt ?? left.id),
    ),
  );
}

function ActivityFeed({
  entries,
  label,
  limit = 8,
  roomy = false,
  showTime = false,
}: {
  entries: ActivityEntry[];
  label: string;
  limit?: number;
  roomy?: boolean;
  showTime?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!entries.length) return null;
  const visibleEntries = showAll ? entries : entries.slice(-limit);
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className={`activity-feed${roomy ? " is-roomy" : ""}`}
      role="log"
    >
      {visibleEntries.map((entry) => (
        <div className={`activity-entry is-${entry.status}`} key={entry.id}>
          <span aria-hidden="true">
            {entry.status === "complete"
              ? "✓"
              : entry.status === "error"
                ? "!"
                : "·"}
          </span>
          <div>
            <header>
              <strong>{entry.text}</strong>
              {showTime && entry.at && (
                <time dateTime={entry.at}>
                  {new Intl.DateTimeFormat(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(entry.at))}
                </time>
              )}
            </header>
            {entry.detail && <small title={entry.detail}>{entry.detail}</small>}
            {entry.output && (
              <details className="activity-output">
                <summary>View details</summary>
                <pre>{entry.output}</pre>
              </details>
            )}
          </div>
        </div>
      ))}
      {entries.length > limit && (
        <button
          className="activity-feed-toggle"
          onClick={() => setShowAll((current) => !current)}
          type="button"
        >
          {showAll ? "Show recent activity" : `View all ${entries.length} events`}
        </button>
      )}
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
        <div className="flow-toolbar-actions">
          <button
            className="button-secondary"
            disabled={disabled || !focusedState}
            onClick={() => {
              if (!focusedState) return;
              onZoomChange(2);
              onEdit(focusedState.id);
            }}
            type="button"
          >
            Edit selected step
          </button>
          <button
            className="button-secondary"
            disabled={disabled || !sequence.loopBack}
            onClick={onAddStep}
            type="button"
          >
            + Add step
          </button>
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
                  <button
                    aria-label={`Edit ${state.name}`}
                    className="flow-node-edit"
                    disabled={disabled}
                    onClick={() => {
                      onFocus(state.id);
                      onZoomChange(2);
                      onEdit(state.id);
                    }}
                    type="button"
                  >
                    Edit
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

    </>
  );
}

const RUNTIME_CONDITION_LABEL: Record<
  RuntimeMapRegion["condition"],
  string
> = {
  active: "Active",
  supported: "Complete",
  review: "Review",
  ready: "Ready",
  waiting: "Waiting",
  uncertain: "Uncertain",
  failed: "Problem",
};

const RUNTIME_CONDITION_MARK: Record<
  RuntimeMapRegion["condition"],
  string
> = {
  active: "◉",
  supported: "✓",
  review: "●",
  ready: "○",
  waiting: "⚠",
  uncertain: "△",
  failed: "!",
};

const RUNTIME_HIGHLIGHT_MARK = {
  active: "◉",
  complete: "✓",
  review: "●",
  ready: "○",
  waiting: "⚠",
  uncertain: "△",
  failed: "!",
} as const;

const RUNTIME_MAP_ZOOM_LABEL: Record<FlowZoom, string> = {
  0: "Overview",
  1: "Trajectory",
  2: "Evidence",
};

const RUNTIME_MAP_ZOOM_DESCRIPTION: Record<FlowZoom, string> = {
  0: "Area progress and health",
  1: "Past result, current work, and next item",
  2: "Tracked units, evidence, and unresolved signals",
};

function RuntimeOperationsMap({
  regions,
  selectedRegion,
  presence,
  phases,
  objective,
  currentObjective,
  unreviewedCount,
  latestResult,
  latestActivity,
  isRunning,
  zoom,
  onSelect,
  onClose,
  onAsk,
  onSteer,
  onInspect,
  onReview,
  onZoom,
}: {
  regions: RuntimeMapRegion[];
  selectedRegion: RuntimeMapRegion | null;
  presence: RuntimePresence | null;
  phases: LoopState[];
  objective: string;
  currentObjective: string;
  unreviewedCount: number;
  latestResult: RuntimeLedgerEntry | null;
  latestActivity: ActivityEntry | null;
  isRunning: boolean;
  zoom: FlowZoom;
  onSelect: (id: string) => void;
  onClose: () => void;
  onAsk: (region: RuntimeMapRegion) => void;
  onSteer: (region: RuntimeMapRegion) => void;
  onInspect: () => void;
  onReview: () => void;
  onZoom: (zoom: FlowZoom) => void;
}) {
  const activePhaseIndex = phases.findIndex(
    (phase) => phase.id === presence?.phaseId,
  );
  const activeRegion = regions.find(
    (region) =>
      presence &&
      (region.id === presence.regionId ||
        region.memberIds.includes(presence.regionId)),
  );
  const completedCount = regions.reduce(
    (total, region) => total + region.completedCount,
    0,
  );
  const uncertaintyCount = regions.reduce(
    (total, region) => total + region.uncertaintyCount,
    0,
  );
  const blockedCount = regions.reduce(
    (total, region) =>
      total +
      region.issueCount +
      (region.condition === "waiting" ? 1 : 0),
    0,
  );
  const topRegions = regions.slice(0, 3);
  const bottomRegions = regions.slice(3, 6);

  const renderRegion = (region: RuntimeMapRegion, index: number) => {
    const hasUnit = activeRegion?.id === region.id;
    const selected = selectedRegion?.id === region.id;
    const trajectory = [
      { slot: "Past", moment: region.past },
      { slot: "Now", moment: region.present },
      { slot: "Next", moment: region.future },
    ].filter(
      (
        item,
      ): item is {
        slot: string;
        moment: NonNullable<RuntimeMapRegion["past"]>;
      } => Boolean(item.moment),
    );
    return (
      <article
        aria-label={`${region.label}, ${region.progress}% of tracked work resolved`}
        className={`runtime-region is-${region.condition} ${
          selected ? "is-selected" : ""
        } ${hasUnit ? "has-unit" : ""}`}
        key={region.id}
        onClick={() => onSelect(region.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(region.id);
          }
        }}
        role="button"
        style={
          {
            "--region-order": index,
          } as CSSProperties
        }
        tabIndex={0}
      >
        <header>
          <strong>{region.label}</strong>
          <span>{region.progress}%</span>
        </header>
        <div
          aria-label={region.progressLabel}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={region.progress}
          className="runtime-region-progress"
          role="progressbar"
          title={`${region.progress}% — ${region.progressLabel}`}
        >
          <span style={{ width: `${region.progress}%` }} />
        </div>
        {hasUnit && presence && (
          <span className="runtime-region-worker-badge">
            <i>◉</i>
            {presence.actor === "worker"
              ? `Worker ${presence.iterationNumber}`
              : "Supervisor"}
          </span>
        )}
        {zoom === 0 ? (
          <div className={`runtime-region-status is-${region.condition}`}>
            <span>{RUNTIME_CONDITION_MARK[region.condition]}</span>
            <strong>{RUNTIME_CONDITION_LABEL[region.condition]}</strong>
            <small>
              {region.reviewCount > 0
                ? `${region.reviewCount} result${region.reviewCount === 1 ? "" : "s"} to review`
                : region.progressLabel}
            </small>
          </div>
        ) : (
          <ul className="runtime-region-trajectory">
            {trajectory.length ? (
              trajectory.map(({ slot, moment }) => (
                <li className={`is-${moment.tone}`} key={slot}>
                  <b>{slot}</b>
                  <span>{RUNTIME_HIGHLIGHT_MARK[moment.tone]}</span>
                  <small>{moment.label}</small>
                </li>
              ))
            ) : (
              <li className="is-ready">
                <b>Next</b>
                <span>○</span>
                <small>No result recorded yet</small>
              </li>
            )}
          </ul>
        )}
        {zoom === 2 && (
          <dl className="runtime-region-evidence">
            <div>
              <dt>Evidence</dt>
              <dd>{region.evidenceCount}</dd>
            </div>
            <div>
              <dt>Uncertain</dt>
              <dd>{region.uncertaintyCount}</dd>
            </div>
            <div>
              <dt>Problems</dt>
              <dd>{region.issueCount}</dd>
            </div>
          </dl>
        )}
        <footer>
          <span>{region.progressLabel}</span>
          {hasUnit && <b>Live here</b>}
          {!hasUnit && region.reviewCount > 0 && (
            <b>{region.reviewCount} to review</b>
          )}
        </footer>
      </article>
    );
  };

  return (
    <section className="runtime-operations-map">
      <header className="runtime-map-heading">
        <div>
          <span className="eyebrow">Project command map</span>
          <h2>{isRunning ? "Work is advancing" : "Project overview"}</h2>
          <p>
            <b>Goal</b>
            {objective}
          </p>
        </div>
        <div className="runtime-map-heading-actions">
          <div
            aria-label="Runtime map detail"
            className="runtime-semantic-zoom"
          >
            <button
              aria-label="Show less map detail"
              disabled={zoom === 0}
              onClick={() => onZoom(Math.max(0, zoom - 1) as FlowZoom)}
              type="button"
            >
              −
            </button>
            <span>
              <strong>{RUNTIME_MAP_ZOOM_LABEL[zoom]}</strong>
              <small>{RUNTIME_MAP_ZOOM_DESCRIPTION[zoom]}</small>
            </span>
            <button
              aria-label="Show more map detail"
              disabled={zoom === 2}
              onClick={() => onZoom(Math.min(2, zoom + 1) as FlowZoom)}
              type="button"
            >
              +
            </button>
          </div>
          {unreviewedCount > 0 ? (
            <button
              className="runtime-review-chip"
              onClick={onReview}
              type="button"
            >
              <span>●</span>
              <strong>{unreviewedCount} finished</strong>
              <small>Not reviewed by you</small>
            </button>
          ) : (
            <span className="runtime-review-clear">✓ You are caught up</span>
          )}
        </div>
      </header>

      <div className="runtime-terrain">
        <div className="runtime-terrain-grid" aria-hidden="true" />
        {regions.length ? (
          <div
            className={`runtime-map-board runtime-map-zoom-${zoom} ${
              presence ? "has-live-worker" : ""
            }`}
          >
            <div className="runtime-region-row is-top">
              {topRegions.map((region, index) => renderRegion(region, index))}
            </div>

            <section
              className={`runtime-mission ${presence ? "is-active" : "is-idle"}`}
            >
              <span>{presence ? "◉ Current mission" : "Next mission"}</span>
              <h3>{presence?.assignmentTitle ?? currentObjective}</h3>
              <div className="runtime-mission-worker">
                <i>{presence?.actor === "supervisor" ? "S" : "W"}</i>
                <div>
                  <strong>
                    {presence
                      ? presence.actor === "worker"
                        ? `Worker ${presence.iterationNumber}`
                        : "Supervisor"
                      : "No worker deployed"}
                  </strong>
                  <small>
                    {presence?.currentAction ??
                      "Start the loop to deploy the next bounded assignment"}
                  </small>
                </div>
                <em>
                  {presence
                    ? `${activeRegion?.label ?? "Project"} · ${presence.phaseName}`
                    : "Ready"}
                </em>
              </div>
              <ol aria-label="Worker loop position">
                {phases.map((phase, phaseIndex) => (
                  <li
                    className={
                      phase.id === presence?.phaseId
                        ? "is-current"
                        : activePhaseIndex >= 0 && phaseIndex < activePhaseIndex
                          ? "is-complete"
                          : ""
                    }
                    key={phase.id}
                  >
                    <span />
                    <small>{phase.name}</small>
                  </li>
                ))}
              </ol>
            </section>

            {bottomRegions.length > 0 && (
              <div className="runtime-region-row is-bottom">
                {bottomRegions.map((region, index) =>
                  renderRegion(region, index + 3),
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="runtime-map-empty">
            <span>◇</span>
            <strong>No project areas are mapped yet</strong>
            <p>
              The first runtime state will turn hypotheses, features, design
              questions, opportunities, or other domain work into this map.
            </p>
          </div>
        )}
      </div>

      {selectedRegion && (
        <section
          className={`runtime-area-dock is-${selectedRegion.condition}`}
        >
          <header>
            <div>
              <span>{RUNTIME_CONDITION_MARK[selectedRegion.condition]}</span>
              <div>
                <small>
                  {RUNTIME_CONDITION_LABEL[selectedRegion.condition]} area
                </small>
                <h3>{selectedRegion.label}</h3>
              </div>
            </div>
            <button
              aria-label="Close area details"
              className="runtime-area-dock-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="runtime-area-dock-trajectory">
            <article>
              <span>Past</span>
              <strong>
                {selectedRegion.past?.label ?? "No integrated result yet"}
              </strong>
              <p>
                {selectedRegion.past?.detail ??
                  "This area has no completed result in the ledger yet."}
              </p>
            </article>
            <article className={selectedRegion.present ? "is-active" : ""}>
              <span>Current</span>
              <strong>
                {selectedRegion.present?.label ??
                  RUNTIME_CONDITION_LABEL[selectedRegion.condition]}
              </strong>
              <p>
                {selectedRegion.present?.detail ?? selectedRegion.summary}
              </p>
            </article>
            <article>
              <span>Next</span>
              <strong>
                {selectedRegion.future?.label ?? "No next item declared"}
              </strong>
              <p>
                {selectedRegion.future?.detail ?? selectedRegion.doneWhen}
              </p>
            </article>
          </div>

          <div className="runtime-area-dock-details">
            <div className="runtime-area-dock-progress">
              <div
                aria-label={selectedRegion.progressLabel}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={selectedRegion.progress}
                className="runtime-region-progress is-large"
                role="progressbar"
              >
                <span style={{ width: `${selectedRegion.progress}%` }} />
              </div>
              <strong>
                {selectedRegion.progress}% · {selectedRegion.progressLabel}
              </strong>
            </div>
            <dl>
              <div>
                <dt>Objective</dt>
                <dd>{selectedRegion.objective}</dd>
              </div>
              <div>
                <dt>Resolved when</dt>
                <dd>{selectedRegion.doneWhen}</dd>
              </div>
            </dl>
          </div>

          <footer>
            <button onClick={() => onAsk(selectedRegion)} type="button">
              Ask about this
            </button>
            <button onClick={() => onSteer(selectedRegion)} type="button">
              Issue direction
            </button>
            <button onClick={onInspect} type="button">
              Inspect details
            </button>
          </footer>
        </section>
      )}

      <div className="runtime-map-ribbon">
        <div className="runtime-map-metrics">
          <span className="is-complete">✓ {completedCount} advances</span>
          <span className="is-review">● {unreviewedCount} to review</span>
          <span className="is-uncertain">△ {uncertaintyCount} uncertain</span>
          <span className="is-failed">! {blockedCount} blocked</span>
          <span className="is-active">◉ {presence ? 1 : 0} active</span>
        </div>
        <p>
          <b>Latest</b>
          {latestResult?.completed ??
            latestActivity?.text ??
            "No integrated result yet"}
          <span>
            →{" "}
            {latestResult?.next ??
              presence?.currentAction ??
              currentObjective}
          </span>
        </p>
      </div>
    </section>
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
  const [activityNote, setActivityNote] = useState<string | null>(null);
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
  const [agentTestActivityNote, setAgentTestActivityNote] =
    useState<string | null>(null);
  const [testActivities, setTestActivities] = useState<ActivityEntry[]>([]);
  const [agentTest, setAgentTest] = useState<AgentTestResult | null>(null);
  const [unifiedTestStage, setUnifiedTestStage] =
    useState<UnifiedTestStage>("idle");
  const [automaticRepairRound, setAutomaticRepairRound] = useState(0);
  const [testAudit, setTestAudit] = useState<string[]>([]);
  const [humanReview, setHumanReview] =
    useState<HumanReviewRequest | null>(null);
  const [dismissedHumanReviewKey, setDismissedHumanReviewKey] =
    useState<string | null>(null);
  const [humanReviewInput, setHumanReviewInput] = useState("");
  const [isHumanReviewSubmitting, setIsHumanReviewSubmitting] = useState(false);
  const [humanReviewError, setHumanReviewError] = useState<string | null>(null);
  const [runtimeRun, setRuntimeRun] = useState<RuntimeRun | null>(null);
  const [runtimeRuns, setRuntimeRuns] = useState<RuntimeRun[]>([]);
  const [runtimeActivity, setRuntimeActivity] = useState("Ready to start");
  const [runtimeActivityNote, setRuntimeActivityNote] =
    useState<string | null>(null);
  const [runtimeActivities, setRuntimeActivities] = useState<ActivityEntry[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeClock, setRuntimeClock] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("design");
  const [runtimeView, setRuntimeView] = useState<RuntimeView>("now");
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<RuntimeSnapshot | null>(null);
  const [runtimeDurationHours, setRuntimeDurationHours] = useState(24);
  const [runtimeUnderstandingInput, setRuntimeUnderstandingInput] = useState("");
  const [runtimeUnderstandingMessages, setRuntimeUnderstandingMessages] =
    useState<RuntimeUnderstandingMessage[]>([]);
  const [isRuntimeUnderstanding, setIsRuntimeUnderstanding] = useState(false);
  const [runtimeComposerMode, setRuntimeComposerMode] =
    useState<"ask" | "steer">("ask");
  const [runtimeMapZoom, setRuntimeMapZoom] = useState<FlowZoom>(1);
  const [selectedRuntimeRegionId, setSelectedRuntimeRegionId] =
    useState<string | null>(null);
  const [isRuntimeCommandOpen, setIsRuntimeCommandOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wiringTestRunRef = useRef(0);
  const unifiedTestRunRef = useRef(0);
  const autoDiscoveryConversationRef = useRef<string | null>(null);
  const sendMessageRef = useRef<
    ((
      textOverride?: string,
      displayText?: string,
      allowDuringTest?: boolean,
    ) => Promise<string | null>) | null
  >(null);

  const sequence = useMemo(
    () => (loop ? primarySequence(loop) : null),
    [loop],
  );
  const findings = useMemo(() => (loop ? validateLoop(loop) : []), [loop]);
  const runtimeMapAnchors = useMemo(() => {
    const frontier = loop?.startingPackage.find(
      (item) => item.role === "frontier",
    );
    return (frontier?.initialContents ?? []).map((title, index) => ({
      id: `${frontier?.id ?? "project-area"}-${index + 1}`,
      title,
      summary: frontier?.description,
      objective: loop?.objective,
    }));
  }, [loop]);
  const runtimeRegions = useMemo(
    () =>
      buildRuntimeMap(runtimeSnapshot?.state ?? null, {
        anchors: runtimeMapAnchors,
        ledger: runtimeSnapshot?.ledger ?? [],
        reviewedThrough:
          runtimeSnapshot?.review?.lastReviewedLedger ?? 0,
        activeRegionId: runtimeSnapshot?.presence?.regionId ?? null,
        maximumRegions: 6,
      }),
    [
      runtimeMapAnchors,
      runtimeSnapshot?.ledger,
      runtimeSnapshot?.presence?.regionId,
      runtimeSnapshot?.review?.lastReviewedLedger,
      runtimeSnapshot?.state,
    ],
  );
  const selectedRuntimeRegion = useMemo(
    () =>
      runtimeRegions.find((region) => region.id === selectedRuntimeRegionId) ??
      null,
    [runtimeRegions, selectedRuntimeRegionId],
  );
  const runtimeLoopPhases = useMemo(
    () =>
      (sequence?.states ?? loop?.states ?? []).filter(
        (state) => !["interrupt", "terminal"].includes(state.kind),
      ),
    [loop?.states, sequence?.states],
  );
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
        runtimeResponse,
      ] = await Promise.all([
        fetch(`${DAEMON_URL}/api/health`),
        fetch(`${DAEMON_URL}/api/loop`),
        fetch(`${DAEMON_URL}/api/conversation`),
        fetch(`${DAEMON_URL}/api/test`),
        fetch(`${DAEMON_URL}/api/run`),
        fetch(`${DAEMON_URL}/api/runtime`),
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
          runs?: RuntimeRun[];
        };
        setRuntimeRun(payload.run);
        setRuntimeRuns(payload.runs ?? (payload.run ? [payload.run] : []));
        setRuntimeActivities(payload.run?.activities ?? []);
        const latestActivity = payload.run?.activities?.at(-1);
        if (payload.run) {
          setRuntimeActivity(
            latestActivity?.text ??
              (payload.run.active ? "Agent is working" : `Run ${payload.run.status}`),
          );
          setRuntimeActivityNote(
            latestActivity?.detail ?? payload.run.summary ?? null,
          );
        }
      }
      if (runtimeResponse.ok) {
        setRuntimeSnapshot(
          (await runtimeResponse.json()) as RuntimeSnapshot,
        );
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
    if (!isRuntimeRunning) return;
    const pollRuntime = async () => {
      const [runResponse, stateResponse] = await Promise.all([
        fetch(`${DAEMON_URL}/api/run`).catch(() => null),
        fetch(`${DAEMON_URL}/api/runtime`).catch(() => null),
      ]);
      if (runResponse?.ok) {
        const payload = (await runResponse.json()) as {
          run: RuntimeRun | null;
          runs?: RuntimeRun[];
        };
        if (payload.run) {
          setRuntimeRun(payload.run);
          setRuntimeRuns(payload.runs ?? [payload.run]);
          setRuntimeActivities(payload.run.activities ?? []);
        }
      }
      if (stateResponse?.ok) {
        setRuntimeSnapshot(
          (await stateResponse.json()) as RuntimeSnapshot,
        );
      }
    };
    const timer = window.setInterval(() => void pollRuntime(), 2000);
    return () => window.clearInterval(timer);
  }, [isRuntimeRunning, runtimeRun?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    messages,
    activity,
    constructionActivities.length,
    runtimeActivities.length,
    runtimeActivity,
  ]);

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
      setActivityNote(null);
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
      setActivityNote(null);
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
    setActivityNote("Connecting to the local agent");
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

          if (
            event.type === "status" ||
            event.type === "activity" ||
            event.type === "heartbeat"
          ) {
            setActivity(event.text);
            setActivityNote(
              typeof event.detail === "string" ? event.detail : null,
            );
            if (event.type !== "heartbeat") {
              setConstructionActivities((current) =>
                appendActivity(current, event),
              );
            }
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
            setActivityNote(null);
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

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (
      !health?.ok ||
      loop ||
      !activeConversationId ||
      messages.length > 0 ||
      isWorking ||
      isConversationChanging ||
      autoDiscoveryConversationRef.current === activeConversationId
    ) {
      return;
    }
    autoDiscoveryConversationRef.current = activeConversationId;
    void sendMessageRef.current?.(
      START_CONSTRUCTION,
      "Inspect this repository and propose its loop",
    );
  }, [
    activeConversationId,
    health?.ok,
    isConversationChanging,
    isWorking,
    loop,
    messages.length,
  ]);

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
  const runtimeIterations = runtimeRun?.iterations ?? [];
  const displayedRuntimeRuns = runtimeRun
    ? upsertRuntimeRun(runtimeRuns, runtimeRun)
    : runtimeRuns;
  const chronologicalRuntimeRuns = [...displayedRuntimeRuns].sort((left, right) =>
    String(left.startedAt ?? left.id).localeCompare(
      String(right.startedAt ?? right.id),
    ),
  );
  const runtimeProgressIterations: RuntimeProgressIteration[] =
    chronologicalRuntimeRuns.flatMap((run, runIndex) =>
      (run.iterations ?? []).map((iteration) => ({
        ...iteration,
        runId: run.id,
        runNumber: runIndex + 1,
      })),
    );
  const currentRuntimeIteration =
    runtimeRun?.currentIteration ?? runtimeIterations.length + 1;
  const runtimeReviewedThrough =
    runtimeSnapshot?.review?.lastReviewedLedger ?? 0;
  const runtimeUnreviewedCount =
    runtimeSnapshot?.ledger.filter(
      (entry) => entry.number > runtimeReviewedThrough,
    ).length ?? 0;
  const visibleRuntimePresence: RuntimePresence | null =
    runtimeSnapshot?.presence ??
    (runtimeSnapshot?.state?.activeAssignment && isRuntimeRunning
      ? {
          actor: "worker",
          status: "working",
          assignmentId: runtimeSnapshot.state.activeAssignment.id,
          assignmentTitle: runtimeSnapshot.state.activeAssignment.title,
          regionId: runtimeSnapshot.state.activeAssignment.frontierId,
          phaseId: runtimeLoopPhases[0]?.id ?? null,
          phaseName: runtimeLoopPhases[0]?.name ?? "Working",
          currentAction: runtimeActivity,
          detail: runtimeActivityNote,
          iterationNumber: currentRuntimeIteration,
          source: "runtime",
          updatedAt: new Date().toISOString(),
        }
      : null);
  const testPanelLabel = isUnifiedTestRunning
    ? TEST_STAGE_LABEL[unifiedTestStage]
    : testPassed
      ? "Passed"
      : pendingHumanReview
        ? "Needs input"
        : currentAgentTest?.verdict === "risk" ||
            currentAgentTest?.verdict === "fail" ||
            unifiedTestStage === "needs-attention"
          ? "Needs repair"
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
                ? "Automatic repair stopped safely"
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
    setAgentTestActivityNote("Connecting to the local test worker");
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
          if (
            event.type === "status" ||
            event.type === "activity" ||
            event.type === "heartbeat"
          ) {
            setAgentTestActivity(event.text);
            setAgentTestActivityNote(
              typeof event.detail === "string" ? event.detail : null,
            );
            if (event.type !== "heartbeat") {
              setTestActivities((current) => appendActivity(current, event));
            }
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
            setAgentTestActivityNote(null);
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
      setAgentTestActivityNote(null);
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
    setAutomaticRepairRound(0);
    setHumanReview(null);
    setAgentTest(null);
    setUnifiedTestStage("tracing");

    try {
      let testedLoop = startingLoop;
      let repairCount = 0;
      const seenLoopSignatures = new Set([
        loopContentSignature(startingLoop),
      ]);

      while (unifiedTestRunRef.current === runId) {
        setUnifiedTestStage(repairCount === 0 ? "tracing" : "retesting");
        const tracePassed = await runWiringTest(testedLoop, false);
        if (unifiedTestRunRef.current !== runId) return;
        appendAudit(
          tracePassed
            ? `Revision ${testedLoop.revision}: every declared transition was traced and the cycle closes.`
            : `Revision ${testedLoop.revision}: the control-flow trace found a structural problem.`,
        );

        let result: AgentTestResult | null = null;
        let repairPrompt: string;
        if (tracePassed) {
          setUnifiedTestStage(repairCount === 0 ? "rehearsing" : "retesting");
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

          const review = extractHumanReview(
            result.report,
            null,
            testedLoop.revision,
          );
          if (review) {
            appendAudit(
              `Revision ${testedLoop.revision}: testing reached a genuinely human-owned decision.`,
            );
            setHumanReview(review);
            setHumanReviewInput("");
            setHumanReviewError(null);
            setUnifiedTestStage("needs-attention");
            return;
          }
          repairPrompt = RESOLVE_TEST_FAILURE;
        } else {
          const traceFindings = validateLoop(testedLoop).filter(
            (finding) => finding.severity === "error",
          );
          appendAudit(
            ...traceFindings.map(
              (finding) => `${finding.title}: ${finding.detail}`,
            ),
          );
          const exactTraceFindings = traceFindings
            .map((finding) => `- ${finding.id}: ${finding.detail}`)
            .join("\n");
          repairPrompt = `The deterministic control-flow trace failed for loop revision ${testedLoop.revision}. This is a machine-owned repair; do not ask the human to choose parser fields, state kinds, transition kinds, or validator wording.

Read .loopit/loop.md and make one smallest coherent update that resolves every exact finding below. Do not inspect unrelated project files and do not change the user's objective.

${exactTraceFindings}`;
        }

        if (repairCount >= MAX_AUTOMATIC_REPAIRS) {
          appendAudit(
            `Loopit stopped safely after ${MAX_AUTOMATIC_REPAIRS} automatic repairs. The latest findings are still unresolved, so another revision will not be created without a new test run.`,
          );
          setUnifiedTestStage("needs-attention");
          return;
        }

        repairCount += 1;
        setAutomaticRepairRound(repairCount);
        setUnifiedTestStage("repairing");
        appendAudit(
          `Automatic repair ${repairCount} of ${MAX_AUTOMATIC_REPAIRS} started for revision ${testedLoop.revision}.`,
        );
        await sendMessage(
          repairPrompt,
          `Automatic repair ${repairCount} of ${MAX_AUTOMATIC_REPAIRS}`,
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
            `Automatic repair ${repairCount} made no durable change. Loopit stopped instead of repeating the same repair.`,
          );
          setUnifiedTestStage("needs-attention");
          return;
        }

        const repairedSignature = loopContentSignature(repairedLoop);
        if (seenLoopSignatures.has(repairedSignature)) {
          appendAudit(
            `Automatic repair ${repairCount} recreated an earlier loop design at revision ${repairedLoop.revision}. Loopit detected the cycle and stopped.`,
          );
          setLoop(repairedLoop);
          setUnifiedTestStage("needs-attention");
          return;
        }

        appendAudit(
          `Automatic repair ${repairCount} created revision ${repairedLoop.revision}.`,
          ...summarizeLoopChanges(testedLoop, repairedLoop),
        );
        seenLoopSignatures.add(repairedSignature);
        testedLoop = repairedLoop;
        setLoop(repairedLoop);
        setParseError(null);
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
      }
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
    setRuntimeActivity("Starting continuous runtime");
    setRuntimeActivityNote("Connecting to the local worker");
    setRuntimeActivities([]);
    setWorkspaceMode("runtime");

    try {
      const response = await fetch(`${DAEMON_URL}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          autonomyMode:
            runtimeSnapshot?.state?.autonomy.mode ?? "guided",
          durationHours:
            runtimeSnapshot?.state?.autonomy.mode === "unattended"
              ? runtimeDurationHours
              : null,
        }),
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
            setRuntimeActivityNote(
              typeof event.detail === "string" ? event.detail : null,
            );
            setRuntimeActivities((current) => appendActivity(current, event));
          }
          if (event.type === "heartbeat") {
            setRuntimeActivity(event.text);
            setRuntimeActivityNote(
              typeof event.detail === "string" ? event.detail : null,
            );
          }
          if (event.type === "run_started" || event.type === "run_updated") {
            const nextRun = event.run as RuntimeRun;
            setRuntimeRun(nextRun);
            setRuntimeRuns((current) => upsertRuntimeRun(current, nextRun));
            if (Array.isArray(event.run.activities)) {
              setRuntimeActivities(event.run.activities as ActivityEntry[]);
            }
          }
          if (event.type === "agent_message") {
            setRuntimeActivity("Worker report saved");
            setRuntimeActivityNote("Preparing the durable iteration handoff");
          }
          if (event.type === "iteration_completed") {
            const iteration = event.iteration as RuntimeIteration;
            setRuntimeRun((current) => {
              if (!current) return current;
              return {
                ...current,
                iterations: [
                  ...(current.iterations ?? []).filter(
                    (item) => item.number !== iteration.number,
                  ),
                  iteration,
                ].sort((left, right) => left.number - right.number),
              };
            });
            setRuntimeRuns((runs) =>
              runs.map((run, index) =>
                index === 0 || run.active
                  ? {
                      ...run,
                      iterations: [
                        ...(run.iterations ?? []).filter(
                          (item) => item.number !== iteration.number,
                        ),
                        iteration,
                      ].sort((left, right) => left.number - right.number),
                    }
                  : run,
              ),
            );
            setRuntimeActivity(
              `Loop iteration ${iteration.number} completed · starting ${iteration.next}`,
            );
            setRuntimeActivityNote(iteration.completed);
          }
          if (event.type === "runtime_state") {
            setRuntimeSnapshot(event.snapshot as RuntimeSnapshot);
          }
          if (event.type === "presence") {
            setRuntimeSnapshot((current) =>
              current
                ? {
                    ...current,
                    presence: event.presence as RuntimePresence,
                  }
                : current,
            );
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

  const setRuntimePolicy = async (mode: "guided" | "unattended") => {
    setRuntimeError(null);
    try {
      const response = await fetch(`${DAEMON_URL}/api/runtime/autonomy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          durationHours: mode === "unattended" ? runtimeDurationHours : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Runtime policy could not be updated.");
      }
      setRuntimeSnapshot(payload as RuntimeSnapshot);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Runtime policy could not be updated.",
      );
    }
  };

  const markRuntimeReviewed = async () => {
    const through = runtimeSnapshot?.ledger.at(-1)?.number ?? 0;
    if (!through) return;
    setRuntimeError(null);
    try {
      const response = await fetch(`${DAEMON_URL}/api/runtime/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ through }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error || "Runtime results could not be marked reviewed.",
        );
      }
      setRuntimeSnapshot(payload as RuntimeSnapshot);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Runtime results could not be marked reviewed.",
      );
    }
  };

  const submitRuntimeComposer = async () => {
    const text = runtimeUnderstandingInput.trim();
    if (!text || isRuntimeUnderstanding) return;
    setRuntimeUnderstandingInput("");
    setRuntimeError(null);

    if (runtimeComposerMode === "steer") {
      setRuntimeUnderstandingMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-steering`,
          role: "steering",
          text,
        },
      ]);
      try {
        const response = await fetch(`${DAEMON_URL}/api/runtime/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directive: text }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "The steering direction was not saved.");
        }
        setRuntimeSnapshot(payload as RuntimeSnapshot);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The steering direction failed.";
        setRuntimeError(message);
        setRuntimeUnderstandingMessages((current) => [
          ...current,
          { id: `${Date.now()}-error`, role: "error", text: message },
        ]);
      }
      return;
    }

    setIsRuntimeUnderstanding(true);
    setRuntimeUnderstandingMessages((current) => [
      ...current,
      { id: `${Date.now()}-question`, role: "user", text },
    ]);
    try {
      const response = await fetch(`${DAEMON_URL}/api/runtime/understand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, question: text }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "The runtime agent could not answer.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
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
          if (event.type === "answer") answer = event.text;
          if (event.type === "error") throw new Error(event.text);
        }
      }
      if (answer) {
        setRuntimeUnderstandingMessages((current) => [
          ...current,
          { id: `${Date.now()}-answer`, role: "agent", text: answer },
        ]);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The runtime agent could not answer.";
      setRuntimeUnderstandingMessages((current) => [
        ...current,
        { id: `${Date.now()}-error`, role: "error", text: message },
      ]);
    } finally {
      setIsRuntimeUnderstanding(false);
    }
  };

  const stopRuntime = async () => {
    setRuntimeActivity("Stopping the loop worker");
    setRuntimeActivityNote("Completed artifacts and iteration history will remain");
    await interrupt();
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
        <nav className="workspace-switcher" aria-label="Loopit workspace">
          <button
            className={workspaceMode === "design" ? "is-active" : ""}
            onClick={() => setWorkspaceMode("design")}
            type="button"
          >
            Design
          </button>
          <button
            className={workspaceMode === "runtime" ? "is-active" : ""}
            disabled={!loop}
            onClick={() => setWorkspaceMode("runtime")}
            type="button"
          >
            Runtime
            {runtimeRun?.active && <span aria-label="running" />}
          </button>
        </nav>
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

      {workspaceMode === "design" ? (
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
                  <div>
                    <strong>{activity}</strong>
                    {activityNote && <small>{activityNote}</small>}
                  </div>
                </div>
                <ActivityFeed
                  entries={constructionActivities}
                  label="Construction agent activity"
                />
              </div>
            )}
            {runtimeRun && runtimeActivities.length > 0 && (
              <section
                className={`live-agent-transcript${
                  isRuntimeRunning ? " is-running" : ""
                }`}
                aria-label={
                  isRuntimeRunning
                    ? "Live worker transcript"
                    : "Most recent worker transcript"
                }
              >
                <header>
                  <div>
                    <span className="eyebrow">
                      {isRuntimeRunning ? "Live work" : "Last worker"}
                    </span>
                    <strong>
                      {runtimeRun.agent === "claude" ? "Claude" : "Codex"} ·
                      iteration {runtimeRun.currentIteration ?? 1}
                    </strong>
                  </div>
                  <span className={`runtime-transcript-status is-${runtimeRun.status}`}>
                    {isRuntimeRunning ? "Running" : runtimeRun.status}
                  </span>
                </header>
                <div className="live-agent-now">
                  {isRuntimeRunning && <span className="pulse-dot" />}
                  <div>
                    <strong>{runtimeActivity}</strong>
                    {runtimeActivityNote && <small>{runtimeActivityNote}</small>}
                  </div>
                  {isRuntimeRunning && (
                    <button onClick={() => void stopRuntime()} type="button">
                      Stop
                    </button>
                  )}
                </div>
                <ActivityFeed
                  entries={runtimeActivities}
                  label="Worker operational transcript"
                  limit={12}
                  roomy
                  showTime
                />
                {!isRuntimeRunning && runtimeRun.summary && (
                  <details className="live-agent-report">
                    <summary>View final worker report</summary>
                    <p>{runtimeRun.summary}</p>
                  </details>
                )}
              </section>
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
              <h2>{isWorking ? "Understanding this repository" : "No loop yet"}</h2>
              <p>
                {isWorking
                  ? "The agent is reading the project, identifying its current work, and preparing a workflow for you to confirm."
                  : "Loopit can inspect this repository first, explain what it appears to do, and propose a recurring workflow for you to confirm."}
              </p>
              <button
                className="button-primary button-large"
                disabled={isWorking}
                onClick={() =>
                  void sendMessage(
                    START_CONSTRUCTION,
                    "Inspect this repository and propose its loop",
                  )
                }
                type="button"
              >
                {isWorking ? "Inspecting repository…" : "Inspect repository"}
              </button>
              <small>Nothing is created until you confirm the agent’s understanding.</small>
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
                        One click checks, repairs, and retests each new revision
                        until the loop passes or needs your decision.
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
                                : unifiedTestStage === "needs-attention"
                                  ? "Retry test"
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
                      unifiedTestStage === "needs-attention" &&
                      !pendingHumanReview && (
                        <div className="test-completion is-blocked">
                          <span aria-hidden="true">!</span>
                          <div>
                            <strong>Automatic testing stopped safely</strong>
                            <p>
                              The audit below explains whether the agent made no
                              change, repeated a design, or reached the repair limit.
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
                          {agentTestActivityNote && (
                            <small>{agentTestActivityNote}</small>
                          )}
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
                            Automatic repair {automaticRepairRound} of{" "}
                            {MAX_AUTOMATIC_REPAIRS}; the next revision will be
                            tested without another click.
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
                className={`runtime-launch design-runtime-handoff ${
                  isRuntimeRunning
                    ? "is-running"
                    : canStartRuntime
                      ? "is-ready"
                      : "is-locked"
                }`}
              >
                <div className="design-runtime-entry">
                  <div>
                    <span className="eyebrow">Next workspace</span>
                    <h3>Run and control the loop</h3>
                    <p>
                      Follow live work, inspect durable state and beliefs,
                      review iteration reports, ask what changed, and steer
                      what happens next.
                    </p>
                  </div>
                  <button
                    className="button-primary button-large"
                    disabled={!testPassed}
                    onClick={() => setWorkspaceMode("runtime")}
                    type="button"
                  >
                    Open Runtime
                  </button>
                </div>
                <header>
                  <div>
                    <span className="eyebrow">Runtime</span>
                    <h3>{isRuntimeRunning ? "Loop is running" : "Start the loop"}</h3>
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
                      {isRuntimeRunning
                        ? `Iteration ${currentRuntimeIteration}`
                        : canStartRuntime
                          ? "Ready"
                          : "Locked"}
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
                        ? `${runtimeProgressIterations.length} loop ${runtimeProgressIterations.length === 1 ? "iteration" : "iterations"} completed across all runs. Loopit will start the next worker automatically unless a real boundary is reached.`
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
                {(isRuntimeRunning || runtimeProgressIterations.length > 0) && (
                  <section className="runtime-iterations" aria-label="Completed loop iterations">
                    <header>
                      <div>
                        <strong>Loop progress</strong>
                        <span>
                          {runtimeProgressIterations.length} completed across{" "}
                          {displayedRuntimeRuns.length}{" "}
                          {displayedRuntimeRuns.length === 1 ? "run" : "runs"}
                          {isRuntimeRunning && ` · iteration ${currentRuntimeIteration} running`}
                        </span>
                      </div>
                      <i aria-hidden="true">↺</i>
                    </header>
                    <ol>
                      {isRuntimeRunning && (
                        <li className="is-running">
                          <span>{currentRuntimeIteration}</span>
                          <div>
                            <header>
                              <small>Current iteration</small>
                              <em>Running</em>
                            </header>
                            <strong>{runtimeActivity}</strong>
                            <p>Following the latest durable state and next work.</p>
                          </div>
                        </li>
                      )}
                      {[...runtimeProgressIterations].reverse().map((iteration) => (
                        <li
                          className={`is-${iteration.outcome}`}
                          key={`${iteration.runId}-${iteration.number}`}
                        >
                          <span>{iteration.number}</span>
                          <div>
                            <header>
                              <small>
                                Run {iteration.runNumber} · iteration {iteration.number}
                              </small>
                              <em>
                                {iteration.outcome === "continue"
                                  ? "Continuing"
                                  : iteration.outcome === "complete"
                                    ? "Objective complete"
                                    : "Paused"}
                              </em>
                            </header>
                            <strong>{iteration.completed}</strong>
                            <p>
                              <b>Next</b>
                              {iteration.next}
                            </p>
                            <small>Next state · {iteration.state}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
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
                      Continuous run · {runtimeRun.status}
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
      ) : (
        <section className="runtime-workspace" aria-label="Runtime control plane">
          <header className="runtime-controlbar">
            <div>
              <span className="eyebrow">Runtime control plane</span>
              <h1>{loop?.name ?? "Runtime"}</h1>
              <p>
                {runtimeSnapshot?.state?.direction.currentDirection ??
                  "Initialize durable state to begin continuous work."}
              </p>
            </div>
            <div className="runtime-controlbar-actions">
              <div className="runtime-autonomy">
                <span>Autonomy</span>
                <div>
                  <button
                    className={
                      runtimeSnapshot?.state?.autonomy.mode !== "unattended"
                        ? "is-active"
                        : ""
                    }
                    onClick={() => void setRuntimePolicy("guided")}
                    type="button"
                  >
                    Guided
                  </button>
                  <button
                    className={
                      runtimeSnapshot?.state?.autonomy.mode === "unattended"
                        ? "is-active"
                        : ""
                    }
                    onClick={() => void setRuntimePolicy("unattended")}
                    type="button"
                  >
                    Unattended
                  </button>
                </div>
              </div>
              {runtimeSnapshot?.state?.autonomy.mode === "unattended" && (
                <label className="runtime-duration">
                  Run for
                  <select
                    onChange={(event) =>
                      setRuntimeDurationHours(Number(event.target.value))
                    }
                    value={runtimeDurationHours}
                  >
                    <option value={1}>1 hour</option>
                    <option value={8}>8 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                  </select>
                </label>
              )}
              <div className="runtime-clock is-controlbar">
                <small>{isRuntimeRunning ? "Continuous run" : "Last run"}</small>
                <time dateTime={`PT${Math.floor(runtimeElapsed / 1000)}S`}>
                  {formatRuntimeDuration(runtimeElapsed)}
                </time>
              </div>
              {isRuntimeRunning ? (
                <button
                  className="button-stop"
                  onClick={() => void stopRuntime()}
                  type="button"
                >
                  Stop
                </button>
              ) : (
                <button
                  className="button-primary"
                  disabled={!canStartRuntime}
                  onClick={() => void startRuntime()}
                  type="button"
                >
                  Start loop
                </button>
              )}
            </div>
          </header>

          <div className="runtime-workspace-grid">
            <section className="runtime-dashboard">
              <nav className="runtime-view-tabs" aria-label="Runtime views">
                {(["now", "state", "frontier", "history"] as RuntimeView[]).map(
                  (view) => (
                    <button
                      className={runtimeView === view ? "is-active" : ""}
                      key={view}
                      onClick={() => setRuntimeView(view)}
                      type="button"
                    >
                      {view === "now"
                        ? "Map"
                        : view === "state"
                          ? "State"
                          : view === "frontier"
                            ? "Next work"
                            : "History"}
                    </button>
                  ),
                )}
              </nav>

              <div className="runtime-view">
                {runtimeView === "now" && (
                  <>
                    <RuntimeOperationsMap
                      currentObjective={
                        runtimeRegionLabel(
                          runtimeSnapshot?.state?.direction.currentObjective ??
                            "Select the next objective-backed assignment",
                        )
                      }
                      isRunning={isRuntimeRunning}
                      latestActivity={runtimeActivities.at(-1) ?? null}
                      latestResult={runtimeSnapshot?.ledger.at(-1) ?? null}
                      onClose={() => {
                        setSelectedRuntimeRegionId(null);
                        setIsRuntimeCommandOpen(false);
                      }}
                      onAsk={(region) => {
                        setSelectedRuntimeRegionId(region.id);
                        setRuntimeComposerMode("ask");
                        setRuntimeUnderstandingInput(
                          `What is happening in ${region.label}, what evidence supports its condition, and what should happen next?`,
                        );
                        setIsRuntimeCommandOpen(true);
                      }}
                      onInspect={() => setRuntimeView("frontier")}
                      onReview={() => setRuntimeView("history")}
                      onSelect={(id) => {
                        setSelectedRuntimeRegionId((current) =>
                          current === id ? null : id,
                        );
                        setIsRuntimeCommandOpen(false);
                      }}
                      onSteer={(region) => {
                        setSelectedRuntimeRegionId(region.id);
                        setRuntimeComposerMode("steer");
                        setRuntimeUnderstandingInput(
                          `Prioritize ${region.label}: `,
                        );
                        setIsRuntimeCommandOpen(true);
                      }}
                      onZoom={setRuntimeMapZoom}
                      objective={
                        runtimeSnapshot?.state?.direction.northStar ??
                        loop?.objective ??
                        "Advance the project"
                      }
                      phases={runtimeLoopPhases}
                      presence={visibleRuntimePresence}
                      regions={runtimeRegions}
                      selectedRegion={selectedRuntimeRegion}
                      unreviewedCount={runtimeUnreviewedCount}
                      zoom={runtimeMapZoom}
                    />

                    {isRuntimeCommandOpen && selectedRuntimeRegion && (
                      <section className="runtime-map-command-console">
                        <header>
                          <div>
                            <small>
                              {runtimeComposerMode === "ask"
                                ? "Ask about"
                                : "Direct work in"}
                            </small>
                            <strong>{selectedRuntimeRegion.label}</strong>
                          </div>
                          <button
                            aria-label="Close command console"
                            onClick={() => setIsRuntimeCommandOpen(false)}
                            type="button"
                          >
                            ×
                          </button>
                        </header>

                        {runtimeUnderstandingMessages.length > 0 && (
                          <div className="runtime-map-command-history">
                            {runtimeUnderstandingMessages.slice(-2).map((message) => (
                              <article
                                className={`is-${message.role}`}
                                key={message.id}
                              >
                                <small>
                                  {message.role === "user"
                                    ? "You"
                                    : message.role === "agent"
                                      ? agent === "codex"
                                        ? "Codex"
                                        : "Claude"
                                      : message.role === "steering"
                                        ? "Direction queued"
                                        : "Error"}
                                </small>
                                <p>{message.text}</p>
                              </article>
                            ))}
                          </div>
                        )}

                        <div className="runtime-composer-mode">
                          <button
                            className={
                              runtimeComposerMode === "ask" ? "is-active" : ""
                            }
                            onClick={() => setRuntimeComposerMode("ask")}
                            type="button"
                          >
                            Ask
                          </button>
                          <button
                            className={
                              runtimeComposerMode === "steer"
                                ? "is-active"
                                : ""
                            }
                            onClick={() => setRuntimeComposerMode("steer")}
                            type="button"
                          >
                            Steer
                          </button>
                        </div>
                        <textarea
                          autoFocus
                          disabled={isRuntimeUnderstanding}
                          onChange={(event) =>
                            setRuntimeUnderstandingInput(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              void submitRuntimeComposer();
                            }
                          }}
                          placeholder={
                            runtimeComposerMode === "ask"
                              ? "Ask what changed, what is blocked, or why this is next."
                              : "Give a direction for this part of the project."
                          }
                          rows={3}
                          value={runtimeUnderstandingInput}
                        />
                        <button
                          className="button-primary"
                          disabled={
                            !runtimeUnderstandingInput.trim() ||
                            isRuntimeUnderstanding
                          }
                          onClick={() => void submitRuntimeComposer()}
                          type="button"
                        >
                          {isRuntimeUnderstanding
                            ? "Reading state…"
                            : runtimeComposerMode === "ask"
                              ? "Ask runtime"
                              : "Queue direction"}
                        </button>
                      </section>
                    )}
                  </>
                )}

                {runtimeView === "state" && (
                  <>
                    <section className="runtime-direction-card">
                      <span className="eyebrow">North star</span>
                      <h2>
                        {runtimeSnapshot?.state?.direction.northStar ??
                          loop?.objective}
                      </h2>
                      <p>
                        {runtimeSnapshot?.state?.direction.currentDirection}
                      </p>
                    </section>
                    <div className="runtime-state-groups">
                      {(["artifact", "belief", "failure", "uncertainty"] as const).map(
                        (kind) => {
                          const items =
                            runtimeSnapshot?.state?.items.filter(
                              (item) => item.kind === kind,
                            ) ?? [];
                          if (!items.length) return null;
                          return (
                            <section key={kind}>
                              <header>
                                <h3>
                                  {kind === "artifact"
                                    ? "What exists"
                                    : kind === "belief"
                                      ? "What we believe"
                                      : kind === "failure"
                                        ? "Known failures"
                                        : "Uncertainty"}
                                </h3>
                                <span>{items.length}</span>
                              </header>
                              {items.map((item) => (
                                <article key={item.id}>
                                  <div>
                                    <strong>{item.name}</strong>
                                    <span>{item.status}</span>
                                  </div>
                                  <p>{item.summary}</p>
                                  {item.evidence.length > 0 && (
                                    <details>
                                      <summary>
                                        Evidence · {item.evidence.length}
                                      </summary>
                                      <ul>
                                        {item.evidence.map((evidence) => (
                                          <li key={evidence}>{evidence}</li>
                                        ))}
                                      </ul>
                                    </details>
                                  )}
                                </article>
                              ))}
                            </section>
                          );
                        },
                      )}
                    </div>
                  </>
                )}

                {runtimeView === "frontier" && (
                  <>
                    <section className="runtime-frontier-summary">
                      <div>
                        <small>Ready</small>
                        <strong>
                          {runtimeSnapshot?.state?.frontier.filter(
                            (item) => item.status === "ready",
                          ).length ?? 0}
                        </strong>
                      </div>
                      <div>
                        <small>Waiting</small>
                        <strong>
                          {runtimeSnapshot?.state?.frontier.filter(
                            (item) => item.status === "waiting",
                          ).length ?? 0}
                        </strong>
                      </div>
                      <div>
                        <small>Human decisions</small>
                        <strong>
                          {runtimeSnapshot?.state?.decisions.filter(
                            (item) => item.status === "waiting",
                          ).length ?? 0}
                        </strong>
                      </div>
                    </section>
                    <section className="runtime-frontier-list">
                      {(runtimeSnapshot?.state?.frontier ?? [])
                        .slice()
                        .sort((left, right) => right.priority - left.priority)
                        .map((item) => (
                          <article className={`is-${item.status}`} key={item.id}>
                            <span>{item.priority}</span>
                            <div>
                              <header>
                                <strong>{item.title}</strong>
                                <em>{item.status}</em>
                              </header>
                              <p>{item.causedBy}</p>
                              <small>
                                <b>Done when</b> {item.retirementEvidence}
                              </small>
                            </div>
                          </article>
                        ))}
                    </section>
                    {(runtimeSnapshot?.state?.decisions ?? []).some(
                      (item) => item.status === "waiting",
                    ) && (
                      <section className="runtime-decisions">
                        <h3>Waiting for human</h3>
                        {runtimeSnapshot?.state?.decisions
                          .filter((item) => item.status === "waiting")
                          .map((item) => (
                            <article key={item.id}>
                              <strong>{item.question}</strong>
                              <p>{item.context}</p>
                              <small>{item.recommendation}</small>
                            </article>
                          ))}
                      </section>
                    )}
                  </>
                )}

                {runtimeView === "history" && (
                  <section className="runtime-ledger">
                    {runtimeUnreviewedCount > 0 && (
                      <aside className="runtime-review-banner">
                        <div>
                          <span>● Needs your review</span>
                          <strong>
                            {runtimeUnreviewedCount} finished{" "}
                            {runtimeUnreviewedCount === 1
                              ? "result is"
                              : "results are"}{" "}
                            new
                          </strong>
                          <small>
                            Inspect the summaries and evidence below, then
                            acknowledge them to clear the map badge.
                          </small>
                        </div>
                        <button
                          onClick={() => void markRuntimeReviewed()}
                          type="button"
                        >
                          Mark all reviewed
                        </button>
                      </aside>
                    )}
                    <header>
                      <div>
                        <span className="eyebrow">Durable trajectory</span>
                        <h2>{runtimeSnapshot?.ledger.length ?? 0} iterations</h2>
                      </div>
                      <span>Newest first</span>
                    </header>
                    {(runtimeSnapshot?.ledger ?? []).length ? (
                      <ol>
                        {[...(runtimeSnapshot?.ledger ?? [])]
                          .reverse()
                          .map((entry) => (
                            <li
                              className={
                                entry.number > runtimeReviewedThrough
                                  ? "is-unreviewed"
                                  : ""
                              }
                              key={entry.id}
                            >
                              <span>{entry.number}</span>
                              <article>
                                <header>
                                  <div>
                                    <small>
                                      Loop r{entry.loopRevision ?? "?"} · state v
                                      {entry.fromVersion} → v{entry.toVersion}
                                    </small>
                                    <h3>{entry.title}</h3>
                                  </div>
                                  <em className={`is-${entry.progress}`}>
                                    {entry.progress}
                                  </em>
                                </header>
                                <strong>{entry.completed}</strong>
                                <p>{entry.reason}</p>
                                <dl>
                                  <div>
                                    <dt>Next</dt>
                                    <dd>{entry.next}</dd>
                                  </div>
                                  <div>
                                    <dt>Report</dt>
                                    <dd>{entry.reportPath}</dd>
                                  </div>
                                </dl>
                                {(entry.stateChanges.length > 0 ||
                                  entry.frontierChanges.length > 0) && (
                                  <details>
                                    <summary>State changes</summary>
                                    <ul>
                                      {[
                                        ...entry.stateChanges,
                                        ...entry.frontierChanges,
                                      ].map((change) => (
                                        <li key={change}>{change}</li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </article>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <p className="runtime-empty-copy">
                        The ledger will record every assignment, report,
                        evidence-based state change, and next action.
                      </p>
                    )}
                  </section>
                )}
              </div>

              {runtimeSnapshot?.steering.some(
                (entry) => entry.status === "pending",
              ) && (
                <aside className="runtime-pending-steering">
                  <strong>Steering queued</strong>
                  <p>
                    {runtimeSnapshot.steering
                      .filter((entry) => entry.status === "pending")
                      .at(-1)?.directive}
                  </p>
                  <span>
                    The supervisor will apply this at the next state
                    integration.
                  </span>
                </aside>
              )}
              {runtimeError && <p className="runtime-error">{runtimeError}</p>}
            </section>
          </div>
        </section>
      )}
    </main>
  );
}
