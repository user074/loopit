---
loopit: 1
revision: 1
status: draft
start: observe-work
---

# Example continuing loop

## Objective

Keep useful work moving while making evidence and stopping conditions explicit.

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
| `loop-complete` | The objective is supported | `complete` | `evaluate-to-complete` |

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

### Loop complete

**ID:** `loop-complete`
**Kind:** `terminal`
**Summary:** Preserve the supported outcome and stop.

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
