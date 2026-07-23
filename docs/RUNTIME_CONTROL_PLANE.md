# Runtime Control Plane

> Status: north-star design plus an implemented first runtime milestone.
>
> Initial scope: one runtime supervisor, one bounded worker at a time, and one
> interactive understanding and steering agent. Concurrent workers and
> multi-agent scheduling are deliberately deferred.

## Implemented first milestone

The current implementation establishes the control-plane spine described below:

- A separate **Design | Runtime** workspace switch.
- A readable canonical state at `.loopit/runtime/STATE.md`.
- Immutable bounded assignments under `.loopit/runtime/assignments/`.
- Detailed worker reports under `.loopit/runtime/reports/`.
- An append-only trajectory at `.loopit/runtime/LEDGER.md`.
- Durable human directions at `.loopit/runtime/STEERING.md`.
- One sequential runtime supervisor and one fresh bounded worker per iteration.
- A fresh read-only, schema-constrained integration turn after every worker
  report. Workers cannot edit `.loopit/` or decide continuation.
- Explicit artifact, belief, failure, and uncertainty state items.
- Objective-linked ready, active, waiting, and retired frontier items.
- Guided and time-bounded unattended autonomy modes.
- Empty-frontier reassessment when unattended mode or new steering requires the
  runtime to generate justified next work.
- Live operational events plus **Now**, **State**, **Next work**, and **History**
  views.
- A separate read-only understanding agent and queued steering UI.
- Recovery checkpoints for interrupted assignments and reports awaiting
  integration.

Transient structured output is used only at the supervisor boundary so the
machine can reject invalid state kinds and statuses. Canonical runtime state,
assignments, reports, the ledger, and steering remain Markdown.

Still deferred are concurrent workers, provider-independent background
survival after the daemon itself exits, time/cost/tool budgets beyond a runtime
duration or iteration cap, automated no-progress detection, generated
interactive HTML, previewable state diffs, report drill-down links, and richer
pause/resume controls.

## Purpose

Loop construction answers whether work has a credible recurring path. The
runtime control plane answers a different set of questions:

1. What is true about the project now?
2. What is the agent doing, and why?
3. What changed during each iteration?
4. What worked, failed, or remains uncertain?
5. What should happen next?
6. Can the system continue safely without waiting for a human?
7. How can a person understand and steer many hours of accumulated work?

Runtime is therefore a separate product workspace, not another section squeezed
under the loop designer.

```text
Design workspace:  Can this loop continue?
Runtime workspace: Is it continuing, what changed, and how can I control it?
```

## Core model

The runtime is an RL-like control system:

```text
State Sₜ
  → supervisor selects bounded action Aₜ
  → worker acts on the project
  → result report Oₜ
  → supervisor evaluates and integrates what changed
  → updated state Sₜ₊₁
  → next action
```

The ledger records the trajectory:

```text
(Sₜ, Aₜ, Oₜ, state changes, Sₜ₊₁)
```

This is initially a control-system abstraction rather than numerical
reinforcement learning. A single scalar reward would invite false optimization.
The supervisor instead evaluates a result across the dimensions that matter to
the project, such as:

- Advancement toward the objective.
- Quality improvement.
- Uncertainty reduction.
- User value.
- Reliability and robustness.
- Important new gaps discovered.
- Cost, time, and risk.

The resulting state, actions, reports, and transitions may later form a useful
trajectory dataset for evaluation or policy improvement.

## Sources of truth

The runtime has a strict hierarchy:

1. **State** is the compressed, current source of truth.
2. **Reports** are the detailed evidence and audit record for bounded actions.
3. **The ledger** is the append-only index of actions, outcomes, state changes,
   and report references.
4. **Project artifacts** are the native deliverables: code, tests, commits,
   prototypes, datasets, analyses, campaigns, decisions, or other work products.
5. **Live events and logs** explain what processes are doing and support
   debugging.
6. **Conversation and generated HTML** are interactive views over those sources;
   they are not canonical state.

Semantic state and reports should remain readable Markdown for both agents and
humans. High-volume operational events may use an internal event store, but
agents should receive curated state, reports, and relevant event excerpts rather
than raw protocol data.

## Generalized state

Research is dominated by hypotheses and evidence. Software, design, and
business work produce both an evolving artifact and an evolving understanding
of that artifact. The runtime state therefore separates two layers.

### What exists

The current project reality:

- Capabilities and deliverables.
- Current versions and decisions.
- Infrastructure and reusable assets.
- Tests and evaluation methods.
- Known defects and missing pieces.
- Work currently in progress.

### What we believe

Evidence-backed claims about the project and its environment:

- What appears to work.
- Under which conditions it works.
- What failed and why.
- What remains uncertain or conflicting.
- Which assumptions are no longer credible.
- What evidence supports each claim.

| Work | What exists | What we believe |
|---|---|---|
| Research | Experiments, data, models, methods | Hypotheses, explanations, and confidence |
| Software | Features, tests, architecture, deployments | Claims about behavior, reliability, maintainability, and usefulness |
| UI/UX | Screens, flows, prototypes, design decisions | Claims about comprehension, friction, accessibility, and user behavior |
| Business | Campaigns, processes, accounts, decisions | Claims about segments, channels, demand, costs, and expected outcomes |

A software feature being implemented is artifact state. A claim that users can
successfully complete the feature's workflow is understanding state supported by
tests, telemetry, critique, or user evidence. Keeping both layers lets Loopit
build abstractions about what works instead of merely accumulating completed
tasks.

## State contract

The generalized runtime state should contain the following concepts. The web UI
must translate them into the project's existing professional language rather
than exposing engine terminology.

```markdown
# Direction

## North star
The long-term outcome the work should advance.

## Current direction
The medium-term strategy currently being emphasized and why.

## Current objective
The bounded improvement being pursued now.

## What better means
The quality dimensions used to find gaps after a plausible first draft.

## What must stay true
Hard requirements, safety constraints, and non-negotiable boundaries.

## What may change
Methods, preferences, scope, and quality targets the supervisor may adjust.

# Current project

## What exists
Current capabilities, deliverables, infrastructure, and known problems.

## What appears to work
Evidence-backed claims with state-item and report references.

## What remains uncertain
Untested, weakly supported, or conflicting claims.

## Known failures and lessons
Failed approaches, their conditions, and when they should or should not be retried.

# Work

## Active assignment
The bounded action currently leased to the worker.

## Frontier
Ranked candidate actions linked to the direction and observed evidence or gaps.

## Waiting for input
Human-owned decisions that can wait while authorized work continues.

# Runtime

## Policy
Autonomy, budget, stopping, recovery, and requirement-relaxation rules.

## Ledger
References to iteration reports and their state transitions.
```

The exact Markdown layout may evolve. The semantic separation is the invariant.

## Goal stack

A binary goal is too brittle for continuing work. A first draft can technically
satisfy a request while remaining incomplete, fragile, untested, confusing, or
low quality. Runtime therefore uses a goal stack:

1. **North star** — the stable, long-term direction. It is rarely simply
   "complete."
2. **Current direction** — the strategy or product area receiving attention.
3. **Current objective** — one bounded, evaluable improvement.
4. **What better means** — quality dimensions the supervisor repeatedly audits.
5. **Current evidence** — whether the artifact actually satisfies those
   dimensions.
6. **Runtime budget** — when an unattended mission must pause regardless of
   remaining opportunities.

The north star supplies direction without turning the first plausible result
into a stopping condition.

## Generating continued progress

After every result, the supervisor performs a gap-finding pass:

- What is incomplete?
- What only appears to work but has not been tested?
- What failed, regressed, or remains fragile?
- What would a real user struggle with?
- What requirement is technically satisfied but poorly satisfied?
- What important scenario or edge case is missing?
- What became possible because of the latest result?
- What nearby improvement most advances the north star?

This is the generalized equivalent of generating new research hypotheses.

Every supervisor-generated objective or frontier item must identify:

1. The north-star outcome or quality dimension it advances.
2. The observation, report, failure, missing evidence, or opportunity that
   caused it to exist.
3. Why it is unresolved and not a duplicate.
4. What evidence would allow the runtime to retire it.

This allows the work space to grow as the agent learns while preventing
unrelated busywork.

## Runtime cycle

The initial runtime uses one supervisor and one worker sequentially:

```text
Read compressed state and steering
  → choose one objective-backed frontier item
  → write an immutable bounded assignment
  → start a fresh worker
  → monitor activity and recover expected failures
  → receive a detailed result report
  → audit the report and native deliverables
  → update artifact state and understanding state
  → append the ledger
  → replenish and reprioritize the frontier
  → evaluate autonomy and stopping policy
  ↺
```

An agent response ending is not a runtime boundary. The supervisor owns
continuation and begins another cycle unless policy says otherwise.

## Bounded assignment

Each worker receives one immutable assignment containing:

- Action and state identifiers.
- The state version it begins from.
- The objective-backed gap it addresses.
- Relevant project context and prior evidence.
- Allowed scope and tools.
- Intended native deliverable.
- Required evaluation or evidence.
- Conditions for completed, partial, failed, or blocked outcomes.
- The required result-report destination.

The worker may recover from expected implementation failures within this
assignment. It does not change the long-term direction, rewrite central state,
or silently expand its scope. It may propose new gaps and objectives in its
report.

## Result report

Every bounded assignment produces a durable report, including negative or
partial outcomes. The report is the portable handoff between worker, supervisor,
understanding agent, future sessions, and the human auditor.

Each report should contain:

- Assignment and starting-state references.
- Motivation and expected result.
- Work performed.
- Native deliverables and artifact references.
- Commands, evaluations, tests, metrics, or user evidence.
- What changed.
- Outcome: completed, partial, failed, or blocked.
- What appears to work and under which conditions.
- Failures, limitations, regressions, and unresolved uncertainty.
- Candidate state updates.
- Candidate follow-up work.
- Provenance: agent, model when available, timestamps, environment, and relevant
  process identifiers.

Reports should keep the important evidence inline while linking to detailed
logs, diffs, plots, builds, prototypes, or other large artifacts for audit.

## Ledger

The ledger is an append-only index, not a replacement for reports. Each entry
should identify:

- Iteration and action.
- Starting and resulting state versions.
- Outcome and progress evaluation.
- State items added, changed, or retired.
- Frontier items added, reprioritized, blocked, or retired.
- Report and native-artifact references.
- Requirement relaxations or human steering applied.

The ledger makes the trajectory inspectable and lets an understanding agent find
the relevant reports without loading the entire history into context.

## State integration and context control

Only the supervisor integrates reports into central state and the ledger.
Workers never directly modify them. This produces a single serialization point
and remains valid if concurrent workers are introduced later.

The supervisor does not depend on a continually growing private conversation.
At the beginning of each cycle it rehydrates from:

- Current state.
- Runtime policy.
- Unapplied steering.
- The active frontier item.
- The latest report.
- Older reports selected through ledger references.

State stays compressed and referential. Reports preserve detail. This controls
context growth without discarding the audit trail.

## Autonomy modes

Runtime initially needs two understandable modes.

### Guided

- The supervisor may choose bounded work from the authorized frontier.
- Material direction changes return to the user.
- Human-owned decisions may pause the affected work.
- The user can review proposed requirement relaxations and new objectives.

### Run unattended

This is an explicit, time- or budget-bounded trigger for full autonomy. The user
authorizes the supervisor to:

- Generate new objectives when the frontier is empty or weak.
- Reprioritize the frontier.
- Relax requirements explicitly marked as flexible.
- Defer human-owned decisions and pursue other objective-backed work.
- Continue after partial and failed results.
- Audit the artifact for missing, fragile, or low-quality areas.
- Keep improving until budget, a hard constraint, an explicit stop, or a genuine
  global blocker is reached.

Before starting an unattended mission, the UI summarizes:

- What the supervisor is trying to improve.
- What it may change.
- What it must not change.
- What resources it may use.
- How long it may run.
- Which conditions can stop the mission.

Full autonomy is not permission to silently redefine the north star, violate a
hard requirement, fabricate evidence, or perform an unauthorized irreversible
or external action.

## Relaxing requirements without losing direction

Runtime distinguishes:

- **Hard requirements** — never relaxed autonomously.
- **Flexible requirements** — may be adjusted when evidence shows that doing so
  advances the north star.
- **Preferences** — methods or qualities the supervisor may trade off.
- **Assumptions** — agent-owned and expected to change with evidence.

When progress is blocked, the supervisor follows a recorded relaxation ladder:

```text
Retry the current approach
  → use an alternative method
  → reduce to a smaller useful slice
  → defer a nonessential flexible requirement
  → pursue another frontier item
  → request human input only when no authorized path remains
```

Each relaxation records:

- The requirement or preference changed.
- Evidence and reason.
- Expected effect.
- Whether it is reversible.
- Which iteration applied it.
- Whether and when it should be revisited.

## Nonblocking human decisions

A human-owned question should block one work item, not necessarily the whole
runtime. When possible, the supervisor:

1. Records the question in `Waiting for input`.
2. Marks only the affected frontier item as waiting.
3. Selects another authorized item.
4. Continues until no useful authorized work remains.

The UI keeps the decision visible without forcing the unattended mission to stop
prematurely.

## Understanding agent

The maintained synthesis file is removed from the core model. Understanding is
generated interactively from state, ledger, reports, native artifacts, and live
events.

The understanding agent is read-only by default and should answer:

- What changed since I last checked?
- What now works, and what evidence supports it?
- What failed, and was it recovered?
- Which assumptions or direction changed?
- What is uncertain?
- What is happening right now?
- Why was this work selected?
- Where would human intervention have the most value?

Answers must cite state-item, iteration, report, and artifact references. The
agent should read relevant reports on demand rather than relying on an old
summary.

## Generated interactive HTML

The understanding agent may generate a self-contained interactive HTML view for
deeper inspection. Useful views include:

- Changes since a selected timestamp or state version.
- Current project map.
- What works, failed, and remains uncertain.
- Evidence graph linking claims to reports and artifacts.
- Iteration timeline.
- Comparisons across iterations.
- Current direction, active assignment, and frontier.
- Filters by state item, outcome, time, or work area.

Generated HTML is a versioned, reproducible view over canonical sources. It may
be cached or saved for the user, but it never becomes the state or report
record. A lower-cost agent may generate the view in a sandbox as long as every
claim links back to its source.

## Steering

Steering is not a hidden message sent into one worker's context. It becomes a
durable control-plane change.

Examples:

- "Focus on reliability" changes current direction.
- "Prioritize onboarding" reprioritizes the frontier.
- "Do not use cloud services" adds a hard constraint.
- "That result is not convincing" creates an evidence challenge or verification
  objective.
- "Stop this approach" retires a direction or frontier item.
- "Pause after this iteration" changes runtime policy.

Steering may change direction, objectives, priorities, constraints, policy, or
future work. It must not rewrite historical evidence. A human correction to a
state claim is recorded with human attribution and can create a verification
item.

The interface should show the affected state and frontier while the user steers.
In guided mode, a material change can be previewed as a state diff. In unattended
mode, changes within the declared authority can apply at the next safe
checkpoint. Structural edits to the loop definition create a staged revision and
never change the contract underneath an active worker.

## Runtime workspace

Loopit should have two top-level modes:

```text
Design | Runtime
```

The Runtime workspace keeps the product's two-panel simplicity.

### Persistent runtime header

- Running, paused, stopping, failed, or completed status.
- Continuous and active working time.
- Current iteration.
- Guided or unattended autonomy.
- Remaining time or budget.
- Pause, resume, stop, and run-unattended controls.

### Left: understand and steer

- Interactive understanding-agent conversation.
- "Since your last visit" queries.
- Evidence-backed answers with report links.
- Generated interactive HTML views.
- Steering requests and visible application status.

### Right: visible control state

The default view should answer without extra navigation:

1. Is the runtime running?
2. What is being worked on?
3. Why was it selected?
4. What changed recently?
5. What currently works or fails?
6. What happens next?
7. Does anything need the human?

Secondary views can expose:

- **Now** — active assignment, live operational transcript, heartbeat, and
  expected result.
- **State** — direction, artifact state, understanding state, gaps, and policy.
- **Frontier** — ranked next work and waiting decisions.
- **History** — ledger and iteration reports.
- **Details** — raw logs, commands, diffs, metrics, and generated HTML.

Runtime state remains visible while the person asks questions or issues
steering. A control action should immediately show what state, priority, or
policy it changed.

## Observability

Runtime has three observability levels:

1. **Live operational events** — planning status, reads, writes, commands, tool
   calls, retries, failures, heartbeats, and worker reports.
2. **Iteration reports** — detailed, durable audit of one bounded assignment.
3. **State transitions** — the compressed meaning of the result and why the next
   action exists.

The UI should emphasize meaningful state and transitions while keeping complete
operational details expandable. Useful runtime measures include:

- Continuous elapsed time.
- Active work time versus waiting or blocked time.
- Iteration duration.
- Time since the last event.
- Completed, partial, failed, and blocked iteration counts.
- Frontier additions and retirements.
- Requirement relaxations.
- State changes supported by evidence.
- Provider usage and cost when the local CLI exposes them.

## Persistence and recovery

A 24-hour runtime cannot depend on the browser or one provider session staying
open. The scheduler must be independent of the UI and checkpoint durable control
state at safe boundaries.

After restart, the runtime should reconcile:

- Last committed state and ledger version.
- Active or interrupted assignment.
- Worker process and session identifiers.
- Existing native artifacts, logs, and partial reports.
- Whether an assignment can resume, must be re-evaluated, or needs a recovery
  report.

The user should be able to close and reopen the UI without changing execution.
The runtime should never claim continuation merely because a process remains
alive; it must continue producing auditable state transitions.

## Initial runtime milestone

The first runtime-control-plane implementation should prove:

1. A separate Runtime workspace opens after a loop passes construction testing.
2. One supervisor owns central state and the ledger.
3. One fresh worker executes one bounded assignment at a time.
4. Every assignment produces a detailed report.
5. The supervisor audits the report and records an explicit state transition.
6. State separates what exists from what appears to work.
7. The frontier is replenished from the north star, quality gaps, and new
   evidence.
8. Guided and time-bounded Run unattended modes work.
9. Human decisions can wait while unrelated authorized work continues.
10. The understanding agent can answer questions from state and reports.
11. Steering updates visible direction, policy, or frontier at a checkpoint.
12. Live activity, reports, ledger, state, and controls remain distinguishable.
13. The runtime can recover an interrupted single-worker cycle from durable
    records.

This milestone must be reliable for one worker before Loopit adds concurrent
workers, subagents, branches, task leases, worktrees, or integration conflicts.

## Deferred

- Concurrent workers and subagents.
- Cross-worker task leases and resource locking.
- Worktree and branch integration.
- Learned action-selection policies.
- Shared remote control planes.
- Organization-level permissions and collaboration.

These features should reuse the same state, assignment, report, ledger,
understanding, steering, observability, and recovery contracts rather than
creating a second runtime model.

## Product principle

The runtime is successful when a person can leave it working, return many hours
later, understand what changed, inspect why the claims are credible, steer the
direction without reconstructing every action, and safely let the work continue.
