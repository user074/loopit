---
loopit: 1
revision: 1
status: draft
start: select-product-gap
---

# Build the AI job-application assistant

## Objective

Build and verify an app that accepts a resume, finds and ranks suitable jobs, completes and submits applications within the user's approved policy, and shows application progress. The app must protect personal data, never invent applicant facts, and pause when a submission needs information or authority the user has not supplied.

## Artifacts

### Product contract

**ID:** `product-contract`
**Kind:** `authoritative`
**Description:** The versioned requirements and acceptance checks for resume ingestion, job preferences, search sources, matching quality, submission autonomy, truthful answers, privacy, and progress tracking.

### Project state

**ID:** `project-state`
**Kind:** `durable`
**Description:** The verified capabilities, current task, decisions, evidence ledger, defects, risks, blockers, and ranked frontier needed for a fresh session to continue.

### App workspace

**ID:** `app-workspace`
**Kind:** `workspace`
**Description:** The application source, tests, fixtures, local data, and reproducible verification outputs that the loop may inspect or change.

## Boundaries

### Human decision required

**ID:** `needs-human`
**Kind:** `interrupt`
**Description:** Pause for missing product choices, credentials or permissions, job-site restrictions, sensitive or legal attestations, ambiguous applicant facts, irreversible external actions, or any real submission outside the user's approved policy.

### Product contract satisfied

**ID:** `product-ready`
**Kind:** `complete`
**Description:** Reproducible end-to-end evidence satisfies the product contract from resume ingestion through approved application submission and progress tracking, with privacy and truthfulness safeguards verified.

## States

### Select the next product gap

**ID:** `select-product-gap`
**Kind:** `decide`
**Summary:** Choose the smallest high-value gap blocking the verified end-to-end experience.

#### Reads

- Product contract
- Project state
- App workspace

#### Instruction

Compare verified behavior with the product contract. Rank unmet acceptance checks, defects, and risks by their effect on the resume-to-tracking journey, then select one bounded vertical slice. Record its rationale, expected user-visible outcome, acceptance check, allowed files or systems, and submission-safety constraints. Prefer sandboxed or mocked job-site interactions unless the product contract explicitly authorizes a real pilot.

#### Writes

- Project state: selected task and acceptance check

#### Completion

One bounded task is justified, completion is already evidenced, or one specific human decision is identified.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `implement-slice` | A bounded task is justified and permitted | `normal` | `select-to-implement` |
| `wait-for-human` | A consequential choice, permission, credential, or applicant fact is missing | `interrupt` | `select-to-human` |
| `loop-complete` | Durable evidence satisfies every product acceptance check | `complete` | `select-to-complete` |

### Implement one product slice

**ID:** `implement-slice`
**Kind:** `act`
**Summary:** Implement only the selected capability or repair.

#### Reads

- Product contract
- Project state: selected task and prior evidence
- App workspace

#### Instruction

Make the smallest coherent change that can satisfy the selected acceptance check. Add or update focused tests and preserve privacy, truthful-answer, and submission-policy controls. Never fabricate qualifications or applicant answers, bypass access controls, or submit a real application unless the recorded policy explicitly permits it. Record changed behavior and any failure or blocker instead of silently expanding scope.

#### Writes

- App workspace: bounded implementation and focused tests
- Project state: implementation record and observed blockers

#### Completion

The selected slice has reproducible implementation or failure evidence ready for evaluation.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `evaluate-slice` | Implementation, failure, or blocker evidence is recorded | `normal` | `implement-to-evaluate` |

### Evaluate the product slice

**ID:** `evaluate-slice`
**Kind:** `evaluate`
**Summary:** Judge the selected slice against its acceptance check and system safeguards.

#### Reads

- Product contract
- Project state: selected task and implementation record
- App workspace

#### Instruction

Run the narrowest relevant automated checks and one representative user flow. Verify the claimed behavior, regressions, error handling, personal-data exposure, truthful-answer handling, and enforcement of the approved submission policy. Use mocks or sandbox targets unless a real pilot is explicitly authorized. Record exact evidence and an explicit pass, fail, or blocked verdict without repairing the implementation during evaluation.

#### Writes

- Project state: evaluation evidence and verdict

#### Completion

The selected task has an inspectable verdict supported by reproducible evidence, including safeguard and regression results.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-project-state` | An evaluation verdict is recorded | `normal` | `evaluate-to-update` |

### Update durable project state

**ID:** `update-project-state`
**Kind:** `update`
**Summary:** Save verified progress and refresh the product frontier.

#### Reads

- Product contract
- Project state: selected task and evaluation verdict
- App workspace

#### Instruction

Mark a capability verified only when its acceptance evidence passes. Otherwise retain or refine the gap. Append the outcome to the evidence ledger; update verified capabilities, defects, risks, blockers, and the ranked frontier; and clear the completed selection. Determine whether another bounded task is justified, the product contract is fully evidenced, or human input is required. Preserve enough context for a fresh session to resume.

#### Writes

- Project state: verified capabilities, evidence ledger, frontier, and next-path rationale

#### Completion

Durable state explains what changed, what remains, and exactly why the loop will continue, interrupt, or complete.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `select-product-gap` | A useful and permitted product gap remains | `continue` | `update-to-select` |
| `wait-for-human` | Progress requires a human decision, permission, credential, or applicant fact | `interrupt` | `update-to-human` |
| `loop-complete` | Reproducible evidence satisfies every product acceptance check | `complete` | `update-to-complete` |

### Wait for human

**ID:** `wait-for-human`
**Kind:** `interrupt`
**Summary:** Request one decision or authorization that materially controls further work.

#### Reads

- Product contract
- Project state: open decision and supporting evidence
- App workspace

#### Instruction

Present one focused question with the relevant evidence, a recommended default, and the consequence of each viable choice. Do not infer sensitive applicant facts or perform the blocked external action while waiting. Record the response and its scope in the product contract or project state before resuming.

#### Writes

- Product contract: approved requirement, fact, constraint, or submission policy when changed
- Project state: human decision and rationale

#### Completion

The response and its scope are durably recorded, or the loop remains explicitly paused.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `select-product-gap` | The response permits more bounded work | `normal` | `human-to-select` |
| `loop-complete` | The response confirms that existing evidence satisfies the product contract | `complete` | `human-to-complete` |

### Loop complete

**ID:** `loop-complete`
**Kind:** `terminal`
**Summary:** Preserve the verified product outcome and stop.

#### Reads

- Product contract
- Project state
- App workspace: accepted build and verification evidence

#### Instruction

Record the accepted build identifier, satisfied acceptance checks, end-to-end evidence, authorized submission behavior, privacy and truthfulness safeguards, known limitations, and recovery or rollback reference. Stop after the final summary points to reproducible evidence.

#### Writes

- Project state: final product-readiness summary

#### Completion

The accepted build and evidence for every product acceptance check are durably identified.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
