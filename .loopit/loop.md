---
loopit: 1
revision: 2
status: draft
completion-policy: confirm
start: frame-capability-slice
---

# Job application agent development loop

## Objective

Develop a privacy-conscious, testable job application agent that can ingest a user-approved profile and resume, discover relevant jobs, rank them against declared interests, prepare or submit truthful applications within explicit user authority, detect interview-related messages in an authorized mailbox, and notify the user. Advance these capabilities through bounded feature slices and sandbox evidence until a fresh completion challenge finds no blocking gap and the user confirms the scoped outcome.

## Starting Package

### Initial job-agent capability evidence map

**ID:** `initial-job-agent-evidence-map`
**Role:** `state`
**Description:** The initial evidence-backed product model that will populate the state portion of the Job-agent capability map and frontier before the start state.

#### Initial Contents

- Observed baseline: the inspected repository contains Loopit's construction application, but it provides no observed implementation, build, fixtures, or test evidence for the proposed job-application agent.
- Mark profile and resume ingestion, privacy controls, job discovery, interest matching, application preparation or authorized submission, interview-email detection, and notification delivery as `unverified`; do not describe any of them as working.
- Record the current product constraints: truthful applicant data only, sandbox or mock integrations by default, no real credentials or personal resume data during the first slice, and no live application submission without explicit authority.
- Reserve an evidence field for each capability containing its Feature-slice brief, build or commit reference, sandbox checks, observed verdict, limitations, and provenance once those results exist.

### Initial job-agent capability gaps

**ID:** `initial-job-agent-capability-gaps`
**Role:** `frontier`
**Description:** The initial objective-grounded unresolved capability frontier that will populate the frontier portion of the Job-agent capability map and frontier; every item is caused by missing product evidence rather than an observed runtime failure.

#### Initial Contents

- `GAP-01 — Applicant profile ingestion and privacy`: advances the profile-and-resume criterion; no implementation or test evidence was found; it remains unresolved because the agent has no verified normalized applicant model or privacy behavior; retire it when synthetic profile and resume scenarios produce the declared normalized fields, validation errors, provenance, and no raw-data logging in sandbox evidence.
- `GAP-02 — Job discovery and normalization`: advances the discover-relevant-jobs criterion; missing adapters, fixtures, and evidence caused the gap; it remains unresolved because no source output is converted into inspectable normalized job records; retire it when an approved fixture or test source yields deduplicated records with source provenance and bounded failure behavior.
- `GAP-03 — Interest-based job ranking`: advances the declared-interests criterion; the absence of a matching model and evaluation evidence caused the gap; it remains unresolved because relevance decisions cannot be explained or checked; retire it when representative positive, negative, and ambiguous fixtures receive reproducible rankings with inspectable reasons.
- `GAP-04 — Truthful application preparation and authorized submission`: advances the application criterion; missing form-mapping behavior, guardrails, and submission-authority policy caused the gap; it remains unresolved because consequential answers and live actions are not safely bounded; retire it when sandbox applications use only approved applicant facts, surface unanswered sensitive fields, honor the recorded approval policy, and produce inspectable receipts without bypassing site safeguards.
- `GAP-05 — Interview-message detection and notification`: advances the mailbox-and-notification criteria; missing provider-neutral message fixtures, classifier evidence, and a user-selected delivery channel caused the gap; it remains unresolved because interview signals and false positives are untested; retire it when authorized test messages yield reproducible detection, non-detection, deduplication, and notification evidence under the recorded mailbox and delivery policy.

### Local applicant-profile sandbox

**ID:** `local-applicant-profile-sandbox`
**Role:** `foundation`
**Description:** The smallest reversible development apparatus needed for the first capability slice, using the repository's existing local Node.js 22 and Git conventions without cloud services, external accounts, or new live-data authority.

#### Initial Contents

- Use an isolated TypeScript module, a focused local test command, and a stable branch or commit reference as the initial build and inspection boundary.
- Prepare synthetic, non-sensitive fixtures for one valid structured profile and plain-text resume, one missing-required-field case, and one conflicting-field case; label all fixtures as fabricated test data.
- Define a minimal normalized applicant schema covering contact placeholders, experience, education, skills, job interests, location or work-mode preferences, and field-level source provenance.
- Apply a default privacy rule that tests may assert validation and redaction behavior but may not print or persist raw resume contents outside the synthetic fixture set.
- Defer scrapers, browser automation, mailbox connections, notification providers, credentials, and live submissions because none is required to inspect the first slice.

### Normalize a synthetic applicant profile and resume

**ID:** `first-applicant-profile-slice`
**Role:** `first-work`
**Description:** The first bounded executable item selected from `GAP-01`, ready for the start state to express as a Feature-slice brief and for the local sandbox to produce the loop's Feature result.

#### Initial Contents

- Implement a local parser that accepts the synthetic structured profile plus plain-text resume and emits the minimal normalized applicant schema with field-level source provenance.
- Reject missing required inputs explicitly, report conflicting profile and resume fields without silently choosing one, and prevent raw resume contents from appearing in logs or generated evidence.
- Deliver a branch or commit containing the parser, schema, fixtures, focused tests, and local run instructions as the Testable job-agent build.
- Evaluate valid, missing-field, conflicting-field, and no-raw-data-logging scenarios; record only observed results and a completed, partial, failed, or blocked verdict in the Feature result.
- Exclude live websites, real applicant data, job ranking, form submission, mailbox access, and notifications from this slice.
- Retire this item only when the sandbox evidence satisfies the declared normalization, validation, provenance, conflict, and privacy checks; otherwise return the unresolved checks through capability-map review.

## Artifacts and Boundaries

### Job-agent capability map and frontier

**ID:** `job-agent-capability-map`
**Kind:** `durable-product-state`
**Description:** The versioned view of objective criteria, implemented behavior, observable evidence, constraints, and unresolved capability gaps. Its initial criteria cover profile and resume ingestion, privacy controls, job discovery, interest matching, truthful application preparation or authorized submission, interview-email detection, and notification delivery. The frontier is derived from the distance between these criteria and current evidence.

### Feature-slice brief

**ID:** `feature-slice-brief`
**Kind:** `bounded-feature-contract`
**Description:** One capability gap translated into a bounded implementation slice, citing the prior capability-map version, objective criterion, triggering evidence, scope, acceptance scenarios, constraints, excluded live actions, intended native deliverable, and evidence that would retire the gap.

### Testable job-agent build

**ID:** `testable-job-agent-build`
**Kind:** `native-deliverable`
**Description:** A stable branch or commit reference, runnable build instructions, tests, and sandbox fixtures or approved test integrations for the selected slice; when no build can be produced, the Feature result identifies the failed or blocked implementation attempt instead.

### Feature result

**ID:** `feature-result`
**Kind:** `result-package`
**Description:** The portable result for one Feature-slice brief. It references the brief and prior-state version; identifies the Testable job-agent build or explicit failed or blocked attempt; records environment, checks, observable evidence, and completed, partial, failed, or blocked outcome; explains changes and limitations; captures unresolved findings and candidate follow-up work; and preserves commit, tool, fixture, and session provenance for a fresh reviewer.

### Product review disposition

**ID:** `product-review-disposition`
**Kind:** `integration-decision`
**Description:** The durable interpretation of a Feature result and exactly one next disposition: objective-backed frontier work, a scheduled observation because external evidence is expected, one human-owned decision, or a completion candidate.

### Boundary input

**ID:** `boundary-input`
**Kind:** `runtime-input`
**Description:** One recorded human decision or scheduled external observation returned from a declared runtime boundary for integration into the capability map and frontier.

### Live actions, accounts, and sensitive answers

**ID:** `live-action-authority`
**Kind:** `interrupt`
**Description:** Pause for explicit scope or authority before using personal credentials or live accounts, exposing profile or resume data outside approved systems, submitting or withdrawing a real application, answering consequential or sensitive application questions, or accepting material site terms. Never fabricate applicant facts or bypass CAPTCHAs, access controls, robots restrictions, or other site safeguards; sandbox and mock integrations remain available development work.

### Accepted job-agent outcome

**ID:** `accepted-job-agent-outcome`
**Kind:** `complete`
**Description:** Completion requires a fresh runtime challenge of the declared objective and evidence, no agent-owned blocking gap, and explicit user acceptance of the scoped product outcome; optional enhancements remain recorded without silently expanding the objective.

## States

### Frame the next job-agent capability slice

**ID:** `frame-capability-slice`
**Kind:** `decide`
**Summary:** Select one objective-backed capability gap and turn it into a testable feature slice.

#### Reads

- Job-agent capability map and frontier

#### Instruction

Compare current product evidence with the objective and select the highest-value unresolved capability gap that can be advanced safely. Confirm that the frontier item cites its objective criterion, triggering result or missing evidence, reason it remains unresolved and non-duplicate, and retirement evidence. Produce one Feature-slice brief with a bounded scope, acceptance and failure scenarios, privacy and authority constraints, excluded live actions, intended Testable job-agent build, and checks that a fresh sandbox evaluator can run without hidden chat context.

#### Writes

- Feature-slice brief

#### Completion

Exactly one inspectable Feature-slice brief is tied to a justified frontier item and contains enough context for implementation to begin.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `build-capability-slice` | The bounded brief names its objective criterion, deliverable, constraints, and acceptance evidence | `normal` | `frame-to-build` |

### Build the selected job-agent capability

**ID:** `build-capability-slice`
**Kind:** `act`
**Summary:** Implement the bounded slice and package the build attempt with inspectable evidence.

#### Reads

- Feature-slice brief

#### Instruction

Implement only the selected slice, using sandbox fixtures or approved test integrations by default. Produce the Testable job-agent build and a Feature result that references the brief and prior capability-map version, records the build or failed attempt, environment, checks and observed evidence, assigns a completed, partial, failed, or blocked outcome, and captures limitations, unresolved findings, candidate follow-ups, and provenance. A negative outcome is a valid result and must not be hidden or rerouted around evaluation.

#### Writes

- Testable job-agent build
- Feature result

#### Completion

A fresh evaluator can inspect a runnable build and preliminary checks, or the Feature result contains an explicit failed or blocked attempt with evidence sufficient to diagnose what happened.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `sandbox-evaluate-slice` | A Feature result records the build attempt and a completed, partial, failed, or blocked outcome | `normal` | `build-to-sandbox-evaluation` |

### Exercise the job-agent slice in a sandbox

**ID:** `sandbox-evaluate-slice`
**Kind:** `evaluate`
**Summary:** Test the slice against its acceptance, failure, privacy, and authority scenarios.

#### Reads

- Feature-slice brief
- Testable job-agent build
- Feature result

#### Instruction

Independently exercise the build in the declared sandbox against every acceptance scenario and the relevant failure, privacy, truthfulness, and authority cases. Add only observed evidence to the Feature result, including environment and reproduction details, and assign the evidence-backed completed, partial, failed, or blocked verdict. If no runnable build exists, inspect and reproduce the recorded failure when possible and preserve why evaluation could not proceed. Record unresolved findings and candidate follow-up work without treating them as accepted frontier items.

#### Writes

- Feature result

#### Completion

The Feature result carries an explicit verdict, observable sandbox evidence for each declared scenario, limitations, and enough provenance for product review in a fresh session.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-capability-map` | The evaluated Feature result is portable and has an explicit completed, partial, failed, or blocked verdict | `normal` | `evaluation-to-capability-update` |

### Update the job-agent capability map

**ID:** `update-capability-map`
**Kind:** `update`
**Summary:** Interpret the feature evidence, update durable product truth, and justify what happens next.

#### Reads

- Job-agent capability map and frontier
- Feature-slice brief
- Feature result
- Boundary input

#### Instruction

Interpret the Feature result against its brief and update the Job-agent capability map and frontier with verified behavior, failed checks, constraints, and evidence provenance. Retire a gap only when its declared retirement evidence exists. Admit a new frontier item only when it cites the objective criterion it advances; the result, observation, failed check, missing evidence, or explicit human scope change that caused it; why it remains unresolved and is not a duplicate; and the evidence that would retire it. Candidate follow-ups enter the frontier only when they satisfy this contract.

If the frontier is empty, compare the entire capability map and current evidence with the objective and record exactly one Product review disposition: one or more newly justified objective-backed frontier items; a scheduled observation naming when, where, and why external evidence is expected; one human-owned decision with the evidence and consequence; or a completion candidate with its supporting evidence and remaining assumptions. Never stop silently or invent unrelated work to preserve motion. Integrate any returned Boundary input before choosing the disposition.

#### Writes

- Job-agent capability map and frontier
- Product review disposition

#### Completion

Durable product state reflects the evaluated result, every frontier change is traceable, and exactly one next disposition is recorded for a fresh session.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `frame-capability-slice` | One or more justified capability-frontier items are ready for another bounded slice | `continue` | `update-to-frame` |
| `await-boundary-input` | The disposition names one human-owned decision or a scheduled observation and no authorized slice can continue first | `interrupt` | `update-to-boundary` |
| `preserve-accepted-outcome` | The disposition is a completion candidate, a fresh runtime challenge finds no agent-owned blocking gap, and the user explicitly accepts the scoped outcome | `complete` | `update-to-accepted-outcome` |

### Await declared boundary input

**ID:** `await-boundary-input`
**Kind:** `interrupt`
**Summary:** Pause for one recorded human decision or scheduled external observation.

#### Reads

- Product review disposition

#### Instruction

Present one focused decision with its evidence, recommendation, and consequence, or preserve the declared observation source and resume condition. Do not broaden authority or infer personal, legal, privacy, site-policy, or product preferences. Record the returned answer or observation as Boundary input so capability review can integrate it without hidden chat context.

#### Writes

- Boundary input

#### Completion

The requested human direction or scheduled observation is recorded with its source and scope.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-capability-map` | The declared Boundary input is available for integration | `normal` | `boundary-to-capability-update` |

### Preserve the accepted job-agent outcome

**ID:** `preserve-accepted-outcome`
**Kind:** `terminal`
**Summary:** Save the challenged evidence and the user's accepted product scope, then stop.

#### Reads

- Job-agent capability map and frontier
- Product review disposition
- Feature result

#### Instruction

Record the accepted objective scope, fresh challenge verdict, human acceptance, supporting capability evidence, known limitations, and optional nonblocking follow-ups in the Product review disposition so the outcome remains inspectable without conversation history.

#### Writes

- Product review disposition

#### Completion

The accepted outcome and its evidence, assumptions, limitations, and optional follow-ups are durably preserved.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
