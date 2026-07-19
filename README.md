# Loopit

**Construct, run, and steer long-running agent loops.**

Loopit is a control plane for continuing agent work. It helps a person turn an objective into a durable, testable loop that can keep making meaningful progress for 24 hours or longer, then makes that loop understandable, steerable, and easy to improve.

> **Project status:** first local construction-studio MVP.

## Try the construction MVP

This version focuses only on the first product problem: working with an agent to construct and rehearse a loop that can actually continue. It does not execute or monitor long-running production work yet.

The screen has two connected parts:

- **Construction chat** launches the Codex or Claude Code CLI already installed and authenticated on the local machine. A new project begins empty: the agent first asks what work the user wants to keep progressing, then proposes the smallest useful loop. The visible conversation survives reloads in local `.loopit/conversation.md` while the selected CLI session preserves the agent's own context.
- **Visual loop editor** presents the repeating route, local decisions, re-entry paths, interrupts, and completion exits without turning them into a tangled graph. The user can edit the objective, state contracts, and transitions directly; every visual save rewrites `.loopit/loop.md`, which the agent reads on its next turn.
- **Preflight testing** can trace every transition in seconds, visibly prove that the recurrence closes, and then launch a fresh read-only local agent to challenge state contracts and edge cases. The rehearsal cannot modify or execute the project; its latest Markdown report is saved at `.loopit/test-report.md`.

Requirements: Node.js 22.13 or newer and at least one locally authenticated agent CLI (`codex` or `claude`). No separate API key or hosted Loopit account is used.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The web process and localhost-only agent daemon start together. Choose **Construct my first loop** or describe the work directly in chat. Construction-agent sessions are remembered in `.loopit/session.json`, the visible conversation in `.loopit/conversation.md`, and the loop proposal in the versionable `.loopit/loop.md`.

Markdown is the durable agent-facing source of truth, not the primary human interface. Loopit parses it into an internal graph for deterministic checks and presents the understandable, interactive version in the web UI. JSON is used only for the machine-owned CLI session identifiers; no generated JSON copy of the loop, conversation, or test report is committed or maintained.

See the [local runbook](RUNBOOK.md) for verification, stopping the current agent turn, stopping both Loopit processes, and recovering when the original terminal is gone.

Loopit inherits the selected CLI's local model configuration. If an older Codex CLI cannot use its configured model, either update it with `codex update` or temporarily select a compatible model for Loopit:

```bash
LOOPIT_CODEX_MODEL=gpt-5.5 npm run dev
```

The seed proposal intentionally uses one small repair cycle—**Validate the loop → Revise durable state → Validate the loop**—plus explicit human-interrupt and completion exits. It is a construction loop for dogfooding Loopit itself, not a claim that every domain needs the same states.

## North star

Most agents are good at bounded tasks: implement a function, run an experiment, produce a draft, or answer a question. Real work does not end with the first result. Each result changes what is known and creates the next useful action.

Today, constructing that feedback loop requires substantial expertise. A person must decide what state survives between agent sessions, which artifacts are authoritative, how results are evaluated, how the next action is selected, and when the agent should continue or interrupt. Even experienced agent users often cannot make useful work continue autonomously for more than an hour.

Loopit should make long-running loops accessible without asking users to manually design a workflow. The user works with an agent in a chat interface. The agent examines the project, asks focused questions, proposes the loop, creates its state and operating rules, and tests that the loop can actually continue. Beside the chat, Loopit visualizes the resulting loop and its live state.

The product develops in two stages:

1. **Construct and prove the loop.** Onboard a user from an objective to a working loop that can transition through multiple states, survive agent and context restarts, and continue for 24+ hours without human intervention unless an explicit boundary is reached.
2. **Operate and evolve the loop.** Show where the work is, summarize what has changed, monitor progress and failures, steer at a high level, and let the user safely test, modify, version, and improve an existing loop.

## What is a loop?

A loop is a durable feedback system that turns unresolved differences between an objective and the current state into evidence-producing actions, updates its state from the evidence, and continues until an explicit boundary is reached.

```text
Objective
   ↓
Read current state
   ↓
Generate unresolved frontier
   ↓
Choose the highest-value item
   ↓
Take a bounded action
   ↓
Observe and evaluate evidence
   ↓
Update durable state
   ↓
Continue, complete, or interrupt
```

A prompt requests an action. A plan anticipates steps. A workflow follows predefined transitions. A loop observes what happened, judges what it means, updates its model of the work, and derives what should happen next.

## The minimal loop contract

Every loop needs:

- **Objective** — the outcome the loop is trying to advance.
- **Durable state** — a compressed, inspectable representation of what is currently true.
- **Frontier** — gaps, uncertainties, failures, missing evidence, or opportunities that justify more work.
- **Action policy** — how the next frontier item is selected under cost, risk, and permission constraints.
- **Evidence** — observable results and artifacts produced by an action.
- **Evaluation** — judgment about whether the action helped and what the evidence means.
- **State transition** — an explicit update to state, frontier, and next action.
- **Boundaries** — the conditions for continuing, completing, requesting a decision, becoming blocked, or exhausting a budget.

The loop engine can remain consistent across domains. What changes is the content of state, the source of frontier items, the available evaluators, and the definition of sufficient progress.

| Domain | Durable state | Frontier | Evidence |
|---|---|---|---|
| Research | Beliefs and current understanding | Uncertain hypotheses | Experimental results |
| Software engineering | Implementation and verified acceptance criteria | Defects, unmet criteria, and missing verification | Tests, runtime behavior, and review findings |
| Design | Current design and user needs | Usability gaps and unresolved alternatives | Evaluations, comparisons, and user feedback |
| Operations | System health and targets | Incidents, anomalies, and capacity risks | Metrics, traces, and interventions |

## Stage 1: construct and prove a loop

The first product problem is not monitoring. It is helping a user create a loop that truly continues.

### Agent-led construction

The user should not need to place nodes or write a loop specification manually. In chat, the construction agent should:

1. Inspect the existing project, tools, documents, and environment.
2. Present its understanding for correction.
3. Clarify the objective, success conditions, constraints, and available resources.
4. Identify what should be durable state and which artifacts are authoritative.
5. Propose how frontier items are created and ranked.
6. Define how actions are evaluated and how evidence changes state.
7. Define autonomy, interruption, budget, recovery, and completion boundaries.
8. Generate the loop and ask the user to confirm the important choices.

### Prove continuity

A circular diagram does not prove that a loop works. Loopit should execute controlled iterations and verify that:

- Current state can produce a justified action.
- The action produces inspectable evidence.
- The evidence is evaluated rather than merely recorded.
- Durable state and the frontier are updated.
- A valid next action or explicit terminal state is produced.
- A fresh agent session can resume from the saved state.
- Failures lead to bounded recovery or escalation instead of silent termination.

The minimal continuity test is:

```text
state before
  → bounded work
  → evidence
  → judgment
  → state after
  → next action
  → resume in a fresh session
```

The 24-hour goal is not simply keeping a process alive. The loop must make meaningful, evidence-backed transitions, recover from expected failures, survive session boundaries, and stop only for a declared reason.

### Loop invariants

Loopit should be able to validate a small set of universal rules:

1. No action without a frontier item.
2. No completed iteration without evidence.
3. No evidence without evaluation.
4. No iteration ends before durable state is updated.
5. No continuation without a justified next action.
6. No stopping except at an explicit boundary.
7. Every saved state must be resumable by a fresh agent session.

The runtime, not an individual agent response, owns continuation. An agent finishing a turn does not mean the mission is complete.

## Stage 2: operate and evolve a loop

Once loops can run reliably, Loopit becomes their operating and improvement environment.

### Understand what is happening

The primary view should emphasize meaningful state rather than raw agent activity:

- Where the loop is now.
- What it is doing and why.
- What changed during the latest iteration.
- What evidence supports the change.
- What remains on the frontier.
- What will happen next by default.
- Whether a human decision is required.
- How much time, money, or compute remains.

Detailed logs should remain available for debugging and auditing, but they are not the normal supervision interface.

### High-level synthesis

Long-running work produces too many plans, reports, logs, and artifacts for a person to read continuously. Loopit should maintain a living synthesis that explains:

- The current understanding of the work.
- The most important findings and changes.
- What succeeded, failed, or remains uncertain.
- The current direction and why it was selected.
- Decisions or risks that deserve human attention.

This synthesis should be generated from the durable state and run evidence, not from an unstructured chat transcript.

### Steering

The user should direct the work at the appropriate level instead of issuing every next action. Steering can apply at different scopes:

- **One action:** investigate a particular item next.
- **This mission:** change a priority or constraint for the current run.
- **Future iterations:** update the loop's selection or evaluation policy.
- **New branch:** try an alternative loop without disturbing the running one.

Every intervention should make its scope clear and become part of the inspectable state.

### Modify and test existing loops

Changing a running loop is a first-class product problem. A user should be able to:

- Explain the desired change conversationally.
- See the agent's proposed loop change and its consequences.
- Test the change on a bounded run or branch.
- Compare behavior and state transitions before and after.
- Apply the change to one mission or future missions.
- Roll back when the modified loop performs worse.

Loop definitions, running state, artifacts, and evaluation history should be versioned separately so that modifying the process does not destroy the work already completed.

## Interface direction

The main interface has two synchronized sides:

```text
┌─────────────────────────────┬──────────────────────────────────────┐
│ CHAT WITH THE LOOP AGENT    │ LOOP STATE                           │
│                             │                                      │
│ Construct the loop          │ Current phase and status             │
│ Explain desired changes     │ Current state and frontier           │
│ Ask why it chose an action  │ Latest evidence and state transition │
│ Steer priorities            │ Next action or interrupt             │
│ Request a test or branch    │ Budget and loop health               │
└─────────────────────────────┴──────────────────────────────────────┘
```

The left side is how the user constructs and modifies the loop with an agent. The right side is not a manual workflow canvas. It is an inspectable representation of what the agent constructed and proof that the loop can continue.

The right side should initially answer five questions:

1. Where is the loop now?
2. What state did this iteration begin with?
3. What work and evidence were produced?
4. How did the state and frontier change?
5. Is there a valid next iteration, or why did the loop stop?

## Reference implementation

[`delta-research`](https://github.com/user074/delta-research) is the first working reference for these ideas. Its research loop maintains beliefs, a run ledger, an experiment frontier, plans, reports, and a human-facing synthesis. Each completed experiment updates the belief state and creates or reprioritizes the next research delta.

Its important lesson is that producing a report is not the end of an iteration. The iteration ends only after the report has been evaluated, durable state has been compressed, and a next action or valid interrupt has been selected.

For software engineering, the same mechanism can use acceptance criteria and observed system behavior instead of research beliefs. Tests, runtime inspection, and review findings create a frontier of unmet criteria, defects, and missing verification. The agent continues resolving that frontier until the agreed outcome is supported by evidence.

## Non-goals for the initial product

- A drag-and-drop workflow builder.
- A collection of animated agent personas.
- An activity dashboard centered on tool calls and token usage.
- Endless autonomous work without an objective or sufficiency condition.
- Allowing the agent to invent product direction when the authorized frontier is empty.
- Treating the chat transcript as the durable record of the work.

## North-star measures

- Time required for a new user to construct their first viable loop.
- Percentage of loops that pass a fresh-session continuity test.
- Duration and number of meaningful state transitions between human interventions.
- Verified progress per human decision.
- Time required to understand the current state of a long-running loop.
- Time required to safely test and deploy a loop modification.
- Frequency of premature, unexplained, or unrecoverable stops.

The central product promise is simple:

> **Help a person and an agent construct a loop that can genuinely continue, then make that loop easy to understand, steer, test, and improve.**
