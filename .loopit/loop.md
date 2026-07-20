---
loopit: 1
revision: 5
status: draft
completion-policy: confirm
start: frame-capability-slice
---

# Job application agent development loop

## Objective

Develop a privacy-conscious, testable job application agent that can ingest a user-approved profile and resume, discover relevant jobs, rank them against declared interests, prepare or submit truthful applications within explicit user authority, prevent duplicate or unauthorized submissions, detect interview-related messages in an authorized mailbox, notify the user, and preserve an inspectable action history. Build it through a familiar software development cycle: choose a backlog item, plan the feature, implement it, test it, review the results, and update the backlog until the agreed product scope is complete.

## Starting Package

### Current product status

**ID:** `initial-job-agent-evidence-map`
**Role:** `state`
**Description:** What is currently implemented, tested, constrained, or still unverified in the job application agent.

#### Initial Contents

- Observed baseline: the inspected repository contains Loopit's construction application, but it provides no observed implementation, build, fixtures, or test evidence for the proposed job-application agent.
- Before development begins, create revision 1 of Product status and feature backlog at `.loopit/runtime/job-agent/product-status.md`, using this starting point and the first planned feature; setup is ready when that file can be read back.
- Mark profile and resume ingestion, privacy controls, job discovery, interest matching, application preparation or authorized submission, duplicate prevention, interview-email detection, notification delivery, and action history as `unverified`; do not describe any of them as working.
- Record the current product constraints: truthful applicant data only, mock integrations by default, no real credentials or personal resume data during the first feature, and no live application submission without explicit permission.
- For each feature, reserve space for its plan, code or commit reference, test results, known limitations, and source information once those results exist.

### Feature backlog

**ID:** `initial-job-agent-capability-gaps`
**Role:** `frontier`
**Description:** The initial list of job-agent features that still need to be built and tested, ordered by their contribution to the product objective.

#### Initial Contents

- `PROFILE-01 — Profile and resume import`: no implementation or tests exist yet. Done when synthetic profiles and resumes produce the required fields, report missing or conflicting data, keep field sources, and do not log raw resume text.
- `DISCOVERY-02 — Job discovery`: no job-source adapter or tests exist yet. Done when an approved test source produces deduplicated job records with source links and clear error handling.
- `MATCHING-03 — Interest-based job ranking`: no ranking implementation or evaluation exists yet. Done when representative good, poor, and ambiguous matches receive reproducible rankings with understandable reasons.
- `APPLICATION-04 — Safe application preparation`: no form mapping, duplicate prevention, or approval flow exists yet. Done when tests use only approved applicant facts, surface unanswered sensitive fields, follow the approval policy, prevent duplicate submissions, and record every attempted action without bypassing site safeguards.
- `MESSAGES-05 — Interview messages and notifications`: no mailbox classifier or notification test exists yet. Done when approved test messages verify detection, non-detection, duplicate handling, and notification delivery through the selected channel.

### Local development and test environment

**ID:** `local-applicant-profile-sandbox`
**Role:** `foundation`
**Description:** The local tools, test data, and Git workflow needed to implement and test the first feature without cloud services, external accounts, or real personal data.

#### Initial Contents

- Use an isolated TypeScript module, a focused local test command, and a stable branch or commit reference as the initial build and inspection boundary.
- Prepare synthetic, non-sensitive fixtures for one valid structured profile and plain-text resume, one missing-required-field case, and one conflicting-field case; label all fixtures as fabricated test data.
- Define a minimal applicant data structure covering contact placeholders, experience, education, skills, job interests, location or work-mode preferences, and the source of each field.
- Apply a default privacy rule that tests may assert validation and redaction behavior but may not print or persist raw resume contents outside the synthetic fixture set.
- Store development notes and test results under `.loopit/runtime/job-agent/`; keep code in Git and record the exact commit or branch in the Test results.
- Defer scrapers, browser automation, mailbox connections, notification providers, credentials, and live submissions because none is required for the first feature.

### Build profile and resume import

**ID:** `first-applicant-profile-slice`
**Role:** `first-work`
**Description:** The first feature selected from the backlog: import a synthetic applicant profile and resume into a consistent data structure and verify its privacy behavior.

#### Initial Contents

- Implement a local parser that accepts the synthetic structured profile plus plain-text resume and produces the agreed applicant data structure with the source of each field.
- Reject missing required inputs explicitly, report conflicting profile and resume fields without silently choosing one, and prevent raw resume contents from appearing in logs or generated evidence.
- Deliver a branch or commit containing the parser, schema, fixtures, focused tests, and local run instructions as Working code.
- Test valid, missing-field, conflicting-field, and no-raw-data-logging scenarios; record only observed outcomes in Test results.
- Exclude live websites, real applicant data, job ranking, form submission, mailbox access, and notifications from this feature.
- Mark this backlog item done only when the data conversion, validation, field-source, conflict, and privacy tests pass; otherwise return the failed checks to the backlog during review.

## Artifacts

### Product status and feature backlog

**ID:** `job-agent-capability-map`
**Description:** The versioned record at `.loopit/runtime/job-agent/product-status.md` of implemented features, test evidence, known constraints, and prioritized backlog items. It covers profile and resume import, privacy, job discovery, matching, truthful and nonduplicate applications, interview-email detection, notifications, and action history.

### Feature plan

**ID:** `feature-slice-brief`
**Description:** The implementation plan at `.loopit/runtime/job-agent/features/<feature-id>/plan.md` for one backlog item, including scope, acceptance criteria, failure cases, privacy constraints, excluded work, and tests required before the feature can be marked done.

### Working code

**ID:** `testable-job-agent-build`
**Description:** A branch or commit containing the implementation, automated tests, test data, and run instructions for the selected feature. If implementation is blocked, Test results record the failed attempt and its cause.

### Test results

**ID:** `feature-result`
**Description:** The observed test record at `.loopit/runtime/job-agent/features/<feature-id>/test-results.md` for one Feature plan. It references the code commit, environment, commands, test data, outputs, passed and failed checks, known limitations, and follow-up bugs so another developer can review or continue the work.

### Review decision

**ID:** `product-review-disposition`
**Description:** The review outcome at `.loopit/runtime/job-agent/review.md`: merge or revise the feature, add or reprioritize backlog work, ask the user for one product decision, wait for a named external result, or propose that the agreed product scope is complete.

### User decision

**ID:** `boundary-input`
**Description:** A product, privacy, permission, or risk decision recorded at `.loopit/runtime/job-agent/user-decision.md` so development can continue without relying on chat history.

### Runtime checkpoint

**ID:** `runtime-checkpoint`
**Description:** A checkpoint at `.loopit/runtime/job-agent/checkpoint.md` recording the current development step, exact input files and versions, partial work, last safe action, interruption cause, and where a fresh session should resume. A checkpoint is never treated as completed development work.

### Release review

**ID:** `completion-challenge`
**Description:** An independent review at `.loopit/runtime/job-agent/release-review.md` that compares the proposed release with the agreed scope and test results. It identifies blocking bugs, one question for the user, or no blocking issue; it cannot approve evidence that has not been observed.

## Boundaries

### Live access and personal data

**ID:** `live-action-authority`
**Kind:** `interrupt`
**Description:** Pause before using personal credentials or live accounts, exposing profile or resume data outside approved systems, submitting or withdrawing a real application, answering sensitive questions, or accepting material site terms. Never fabricate applicant facts or bypass site safeguards. If permission is missing, block the live action, save a Runtime checkpoint, record the problem in Test results, and request one User decision before development continues.

### Time or cost limit

**ID:** `runtime-budget-reached`
**Kind:** `budget`
**Description:** Pause at the configured time, spend, or resource limit after saving a Runtime checkpoint. Resume the same development step later; never treat an interrupted feature as completed work.

### Resume after interruption

**ID:** `interrupted-session-recovery`
**Kind:** `interrupt`
**Description:** At each development step and saved output, refresh the Runtime checkpoint. After a session or tool interruption, verify the recorded files and partial work, then resume at the last safe action without duplicating external actions or claiming completion.

### Accepted release

**ID:** `accepted-job-agent-outcome`
**Kind:** `complete`
**Description:** Finish only after an independent Release review finds no blocking issue and the user accepts the agreed product scope. Keep optional enhancements in the backlog without silently expanding the release.

## States

### Plan the next feature

**ID:** `frame-capability-slice`
**Kind:** `decide`
**Summary:** Choose the highest-priority backlog item and define its scope, acceptance criteria, and tests.

#### Reads

- Product status and feature backlog
- Build profile and resume import

#### Instruction

On the first iteration, plan Build profile and resume import. After that, compare Product status and feature backlog with the objective and choose the highest-priority unresolved feature. Confirm why it matters, why it is not already done, and which tests would allow it to be marked complete. Write one Feature plan with bounded scope, acceptance criteria, failure cases, privacy and permission constraints, excluded work, and tests another developer can run without chat history.

#### Writes

- Feature plan

#### Completion

Exactly one Feature plan is tied to a prioritized backlog item and contains enough information for implementation to begin.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `build-capability-slice` | The Feature plan defines the scope, acceptance criteria, constraints, and required tests | `normal` | `frame-to-build` |

### Implement the feature

**ID:** `build-capability-slice`
**Kind:** `act`
**Summary:** Write the code and focused automated tests described in the Feature plan.

#### Reads

- Feature plan
- Local development and test environment

#### Instruction

Implement only the planned feature, using the Local development and test environment for the first iteration and approved test integrations later. Produce Working code and begin Test results that reference the Feature plan, code commit, environment, checks already run, known limitations, and any failed or blocked implementation attempt. Failed work still goes to testing and review; do not hide it or invent a separate process.

#### Writes

- Working code
- Test results

#### Completion

Another developer can inspect the Working code and preliminary tests, or Test results clearly explain why implementation failed or is blocked.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `sandbox-evaluate-slice` | Working code or a documented failed or blocked implementation attempt is ready for testing | `normal` | `build-to-sandbox-evaluation` |

### Test the feature

**ID:** `sandbox-evaluate-slice`
**Kind:** `evaluate`
**Summary:** Run the planned automated and local tests, then record what passed, failed, or remains blocked.

#### Reads

- Feature plan
- Working code
- Test results

#### Instruction

Run the Working code against every acceptance criterion and the relevant failure, privacy, truthfulness, duplicate-action, and permission cases in the Feature plan. Add only observed outcomes to Test results, including the environment and reproduction steps. If the code cannot run, reproduce the failure when possible and record why testing could not continue. List bugs and follow-up work for review without adding them to the backlog automatically.

#### Writes

- Test results

#### Completion

Test results show the outcome of every planned scenario, known limitations, and enough detail for another developer to review the feature.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-capability-map` | Test results record what passed, failed, or remains blocked | `normal` | `evaluation-to-capability-update` |

### Review results and update the backlog

**ID:** `update-capability-map`
**Kind:** `update`
**Summary:** Review the code and tests, update product status, and choose the next backlog item or release decision.

#### Reads

- Product status and feature backlog
- Feature plan
- Test results
- User decision
- Release review

#### Instruction

Review Test results against the Feature plan. Update Product status and feature backlog with verified behavior, failed checks, and known constraints. Mark a backlog item done only when its acceptance criteria pass. Add a bug or follow-up only when it supports an objective requirement, is caused by a test result or explicit user scope change, is not a duplicate, and has a clear condition for completion.

If the backlog is empty, compare Product status and test evidence with the objective and record exactly one Review decision: add one or more justified backlog items, wait for a named external result, ask the user for one product decision, or propose a release with its supporting tests and remaining assumptions. Never stop silently or invent unrelated features merely to keep working. Apply any returned User decision before choosing.

When review proposes a release, run a fresh Release review. Add blocking bugs to the backlog, send one product question or rejection to `await-boundary-input`, and finish only when the review finds no blocking issue and the user accepts the proposed release.

#### Writes

- Product status and feature backlog
- Review decision

#### Completion

Product status reflects the test results and any User decision or Release review, every backlog change is explained, and one next action is recorded for another developer.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `frame-capability-slice` | Review leaves one or more prioritized backlog items ready for development | `continue` | `update-to-frame` |
| `await-boundary-input` | Review needs one user decision or named external result before development can continue | `interrupt` | `update-to-boundary` |
| `preserve-accepted-outcome` | Review proposes a release, the independent Release review finds no blocking issue, and the user accepts it | `complete` | `update-to-accepted-outcome` |

### Ask for a user decision

**ID:** `await-boundary-input`
**Kind:** `interrupt`
**Summary:** Pause for one product, privacy, permission, or risk decision that only the user can make.

#### Reads

- Review decision

#### Instruction

Present one focused question with the relevant test evidence, recommendation, and consequence, or name the external result and when to check it. Do not infer personal, legal, privacy, site-policy, or product preferences. Record the answer as User decision so development can continue without chat history.

#### Writes

- User decision

#### Completion

The requested human direction or scheduled observation is recorded with its source and scope.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-capability-map` | The User decision or named external result is available for review | `normal` | `boundary-to-capability-update` |

### Record the accepted release

**ID:** `preserve-accepted-outcome`
**Kind:** `terminal`
**Summary:** Save the accepted release scope, supporting tests, and known limitations, then stop.

#### Reads

- Product status and feature backlog
- Review decision
- Test results
- Release review

#### Instruction

Record the accepted product scope, Release review, user acceptance, supporting Test results, known limitations, and optional backlog items in the Review decision so another developer can understand the release without chat history.

#### Writes

- Review decision

#### Completion

The accepted outcome and its evidence, assumptions, limitations, and optional follow-ups are durably preserved.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
