---
loopit: 1
revision: 1
status: draft
completion-policy: confirm
start: observe-work
---

# Example continuing loop

## Objective

Keep useful work moving while making evidence and stopping conditions explicit.

## Starting Package

### Evidence-backed work state

**ID:** `work-evidence-state`
**Role:** `state`
**Description:** Inspectable claims about current progress, supporting evidence, counterevidence, assumptions, and unresolved uncertainty.

#### Initial Contents

- The objective exists but has not yet been supported by execution evidence.

### Objective gap frontier

**ID:** `objective-gap-frontier`
**Role:** `frontier`
**Description:** Initial unresolved items derived by comparing the objective with the evidence-backed work state.

#### Initial Contents

- Establish the first observable result that can update the work state.

### Durable workbench

**ID:** `working-foundation`
**Role:** `foundation`
**Description:** The minimal tools, durable workspace, evidence format, and authority needed to perform and inspect the first item.

#### Initial Contents

- Use the local workspace and record evidence in durable Markdown.

### First evidence-producing item

**ID:** `first-work-item`
**Role:** `first-work`
**Description:** The first bounded item selected from the objective gap frontier and ready for the start state.

#### Initial Contents

- Inspect current durable state and select one objective-backed unresolved item.

## Artifacts

### Loop definition

**ID:** `loop-definition`
**Description:** The agent-readable loop source.

## Boundaries

### Human judgment

**ID:** `needs-human`
**Kind:** `interrupt`
**Description:** A consequential choice cannot be made safely.

### Complete

**ID:** `complete`
**Kind:** `complete`
**Description:** The objective is supported by evidence.

## States

### Observe current work

**ID:** `observe-work`
**Kind:** `observe`
**Summary:** Read the current durable state and unresolved work.

#### Reads

- Current state

#### Instruction

Identify the most important unresolved item supported by current evidence.

#### Writes

- Selected item

#### Completion

One justified item is selected.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `evaluate-work` | An item can be selected safely | `normal` | `observe-to-evaluate` |
| `wait-for-human` | A consequential choice is ambiguous | `interrupt` | `observe-to-human` |

### Evaluate evidence

**ID:** `evaluate-work`
**Kind:** `evaluate`
**Summary:** Judge what the latest evidence means.

#### Reads

- Selected item
- Evidence

#### Instruction

Compare observed evidence with the objective and decide what changed.

#### Writes

- Evaluation

#### Completion

The evidence has an explicit interpretation.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-state` | More useful work remains | `normal` | `evaluate-to-update` |
| `challenge-completion` | The objective appears supported by current evidence | `normal` | `evaluate-to-challenge` |

### Update durable state

**ID:** `update-state`
**Kind:** `update`
**Summary:** Save what changed and refresh unresolved work.

#### Reads

- Evaluation

#### Instruction

Update durable state so a fresh agent can continue without hidden context.

#### Writes

- Current state
- Unresolved work

#### Completion

The next session can resume from saved state.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `evaluate-work` | Updated state reveals more work | `continue` | `update-to-evaluate` |

### Challenge candidate completion

**ID:** `challenge-completion`
**Kind:** `challenge`
**Summary:** Let a fresh agent try to disprove that the objective is complete.

#### Reads

- Current state
- Evaluation
- Evidence

#### Instruction

Independently challenge the candidate against the objective. Classify each new thought as an agent-owned blocking gap, a human preference or intent decision, or an optional follow-up that does not block this outcome.

#### Writes

- Completion challenge
- Optional follow-up backlog

#### Completion

The candidate has an explicit evidence-backed verdict and every new thought has an owner and next action.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-state` | An agent-owned blocking gap remains | `normal` | `challenge-to-update` |
| `confirm-completion` | No blocking gap remains and the candidate is ready for human acceptance | `interrupt` | `challenge-to-confirm` |

### Wait for human

**ID:** `wait-for-human`
**Kind:** `interrupt`
**Summary:** Ask for one consequential decision.

#### Reads

- Open decision

#### Instruction

Present the decision, evidence, recommendation, and consequence.

#### Writes

- Human decision

#### Completion

The decision is clear enough to continue.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-state` | The human answers | `normal` | `human-to-update` |

### Confirm candidate completion

**ID:** `confirm-completion`
**Kind:** `interrupt`
**Summary:** Ask whether to accept the challenged candidate or incorporate another human thought.

#### Reads

- Completion challenge
- Optional follow-up backlog

#### Instruction

Present the candidate, evidence, challenger verdict, and optional follow-ups. Ask one focused question: accept this outcome, or provide a thought that should become another blocking gap.

#### Writes

- Human completion decision

#### Completion

The acceptance or new blocking input is recorded explicitly.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `loop-complete` | The human accepts the challenged candidate | `complete` | `confirm-to-complete` |
| `update-state` | The human adds a blocking thought | `normal` | `confirm-to-update` |

### Loop complete

**ID:** `loop-complete`
**Kind:** `terminal`
**Summary:** Preserve the challenged and accepted outcome, then stop.

#### Reads

- Current state

#### Instruction

Summarize the outcome and remaining assumptions.

#### Writes

- Final summary

#### Completion

The completion evidence is saved.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
