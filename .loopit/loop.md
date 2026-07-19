---
loopit: 1
revision: 1
status: draft
start: understand-goal
---

# Construct Loopit’s first usable loop

## Objective

Turn a user’s goal into a minimal, inspectable loop whose state handoffs, evidence, continuation path, interrupts, and completion conditions can be understood and debugged with a local agent.

## Artifacts

### Project context

**ID:** `project-context`
**Description:** README, existing project files, and the user’s explanation.

### Loop definition

**ID:** `loop-definition`
**Description:** The agent-readable `.loopit/loop.md` source rendered by the Loopit web interface.

## Boundaries

### Human judgment required

**ID:** `needs-judgment`
**Kind:** `interrupt`
**Description:** The agent cannot safely choose between materially different objectives or policies.

### Loop confirmed

**ID:** `confirmed`
**Kind:** `complete`
**Description:** The user accepts the loop and no blocking structural findings remain.

## States

### Understand the goal

**ID:** `understand-goal`
**Kind:** `observe`
**Summary:** Inspect the project and establish what continuing work should accomplish.

#### Reads

- Project context
- User messages

#### Instruction

Inspect the project before asking focused questions about the objective, constraints, and evidence of success.

#### Writes

- Objective
- Constraints

#### Completion

The objective is concrete enough to distinguish useful progress from unrelated activity.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `define-state` | The objective and constraints are clear | `normal` | `goal-to-state` |
| `waiting-for-human` | A consequential ambiguity remains | `interrupt` | `goal-to-human` |

### Define durable state

**ID:** `define-state`
**Kind:** `decide`
**Summary:** Identify what must survive between agent sessions and which artifacts are authoritative.

#### Reads

- Objective
- Constraints
- Project context

#### Instruction

Propose the smallest durable state that another fresh agent could use to resume the work.

#### Writes

- State contract
- Artifact roles

#### Completion

Every essential fact, open item, and artifact has an explicit owner and representation.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `define-transitions` | The state handoff is explicit | `normal` | `state-to-flow` |

### Define transitions

**ID:** `define-transitions`
**Kind:** `decide`
**Summary:** Describe how evidence moves work from one state to the next.

#### Reads

- Objective
- State contract
- Artifact roles

#### Instruction

Propose bounded actions, completion checks, transition conditions, interrupts, and a path back into continuing work.

#### Writes

- Loop states
- Transition conditions
- Boundaries

#### Completion

Every nonterminal state has an evidence-backed next path.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `validate-loop` | A complete draft graph exists | `normal` | `flow-to-validate` |

### Validate the loop

**ID:** `validate-loop`
**Kind:** `evaluate`
**Summary:** Look for dead ends, missing evidence, broken handoffs, and absent continuation paths.

#### Reads

- Loop states
- Transition conditions
- State contract
- Boundaries

#### Instruction

Run deterministic structural checks and explain any semantic uncertainty that still needs review.

#### Writes

- Validation findings

#### Completion

Every finding points to a specific state or relation and suggests a repair.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `revise-loop` | A structural or semantic gap remains | `normal` | `validate-to-revise` |
| `loop-confirmed` | No blocking findings remain and the user confirms the proposal | `complete` | `validate-to-done` |
| `waiting-for-human` | A product or policy choice requires human judgment | `interrupt` | `validate-to-human` |

### Revise durable state

**ID:** `revise-loop`
**Kind:** `update`
**Summary:** Repair the proposed loop while preserving the user’s objective and prior decisions.

#### Reads

- Validation findings
- User messages
- `.loopit/loop.md`

#### Instruction

Make the smallest coherent change that resolves the selected finding or user correction.

#### Writes

- `.loopit/loop.md`
- Revision summary

#### Completion

The draft revision is saved and its changes can be inspected.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `validate-loop` | The revised draft is ready to check again | `continue` | `revise-to-validate` |

### Wait for human judgment

**ID:** `waiting-for-human`
**Kind:** `interrupt`
**Summary:** Pause only for a consequential choice the agent cannot safely make.

#### Reads

- Open decision
- Agent recommendation

#### Instruction

Present the decision, evidence, options, recommendation, and default consequence concisely.

#### Writes

- Human decision

#### Completion

The user supplies enough direction to revise the loop.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `revise-loop` | The user answers the open decision | `normal` | `human-to-revise` |

### Loop confirmed

**ID:** `loop-confirmed`
**Kind:** `terminal`
**Summary:** The construction result is ready for a controlled execution test.

#### Reads

- `.loopit/loop.md`
- Validation findings
- Human decision

#### Instruction

Freeze the confirmed revision and summarize its objective, cycle, boundaries, and remaining assumptions.

#### Writes

- Confirmed loop version

#### Completion

The confirmed loop is saved as the next execution candidate.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
