---
loopit: 1
revision: 5
status: draft
completion-policy: confirm
start: plan-feature
---

# Build the job application assistant

## Objective

Develop a privacy-conscious, testable job application assistant that lets a user enter a profile and provide a résumé; finds roles from explicitly permitted sources; ranks them against declared interests and eligibility rules; prepares truthful application answers; automatically submits when an enabled, versioned rule the user has pre-authorized covers the job and every answer; prevents duplicate or otherwise unauthorized applications; monitors an authorized mailbox for interview-related messages; and notifies the user. Applications outside the current rules require a user decision rather than submission. A release is a completion candidate only when fixture or sandbox evidence covers the agreed capabilities, any approved live integrations have been tested without bypassing site safeguards, an independent release review finds no blocking gap, and the user confirms the scoped outcome.

## Starting Package

### Current product status

**ID:** `job-assistant-status`
**Role:** `state`
**Description:** The implementation and test status of each user-visible job-assistant capability, with evidence references and known constraints.

#### Initial Contents

- `Repository evidence · observed` — inspection on 2026-07-19 found the Loopit construction application but no current job-assistant implementation, fixtures, build, or test evidence.
- `Profile and résumé intake · not started` — no structured applicant profile, résumé parser, correction flow, or validation evidence exists.
- `Interest and eligibility matching · not started` — no declared preference rules, scoring explanation, or job-fixture tests exist.
- `Job discovery · not started` — no permitted-source adapter, listing normalization, or duplicate detection exists.
- `Application preparation · not started` — no truthful answer generator, missing-answer handling, or form-fixture evidence exists.
- `Submission policy · decided` — the human review for loop revision 4 authorizes automatic submission when an enabled rule the user explicitly pre-authorized covers the job and every application answer; unmatched or ambiguous applications require review.
- `Submission controls · not started` — the policy is decided, but no versioned rule store, rule-match gate, idempotency guard, audit trail, or sandbox submission evidence exists.
- `Application history · not started` — no inspectable record of discovered, prepared, skipped, submitted, or failed applications exists.
- `Interview email detection · not started` — no authorized mailbox adapter, message classifier, or email-fixture tests exist.
- `Notifications · not started` — no configured destination or delivery evidence exists; the initial safe default is an in-app notification.
- `Safety constraints · proposed` — use synthetic data and mock integrations first, never invent applicant facts, never bypass CAPTCHAs or access controls, and perform no live submission or mailbox access until the user separately authorizes the account and source; after that authorization, a rule-matched application does not require per-application approval.

### Feature backlog

**ID:** `job-assistant-backlog`
**Role:** `frontier`
**Description:** Prioritized, objective-backed job-assistant features and bugs, each tied to its cause and the evidence required to mark it done.

#### Initial Contents

- `JA-001 — Import profile and résumé` — advances applicant intake; created because no implementation exists; unresolved until a user can enter a profile, import a PDF or text résumé, correct extracted fields, and pass validation and privacy tests.
- `JA-002 — Score saved job listings` — advances interest matching; created by missing matching evidence; unresolved until deterministic job fixtures are ranked against declared preferences with eligibility gates and an inspectable explanation.
- `JA-003 — Collect and deduplicate listings` — advances job discovery and duplicate prevention; created by missing source adapters; unresolved until one explicitly permitted feed or sandbox source is normalized and repeated listings are not re-added.
- `JA-004 — Prepare a truthful application` — advances application completion; created by missing form handling; unresolved until a saved application-form fixture is filled from sourced profile fields while unknown or consequential answers are left for the user.
- `JA-005 — Enforce pre-authorized submission` — advances authorized automation and application history; created by the decided auto-submit policy and risk of unintended submissions; unresolved until sandbox tests prove that only an enabled, versioned rule match with fully sourced or pre-authorized answers can submit automatically, while unmatched, ambiguous, duplicate, expired-rule, denied-access, failure, and retry cases cannot submit and every attempt has an audit record.
- `JA-006 — Detect interview messages` — advances interview monitoring; created by missing mailbox evidence; unresolved until interview, rejection, recruiter, and unrelated RFC 822 fixtures are classified with recorded precision and recall and ambiguous messages are surfaced.
- `JA-007 — Deliver interview notifications` — advances timely notification; created by missing delivery evidence; unresolved until a detected interview fixture produces one deduplicated in-app notification and a configurable destination can be added without changing detection logic.

### Development setup

**ID:** `job-assistant-setup`
**Role:** `foundation`
**Description:** The concrete local architecture, tools, fixtures, commands, data rules, and development workflow used to build and inspect the first feature safely.

#### Initial Contents

- `Workspace` — keep the existing Loopit application intact and create the proposed product as an isolated `job-assistant/` package in this repository; preserve unrelated working-tree changes.
- `Stack` — use Node.js 22.13 or newer, TypeScript 5.9, Next.js 16, React 19, npm with a committed lockfile, ESLint, and the built-in Node test runner, matching the inspected repository conventions.
- `Architecture` — use a local-first Next.js UI and server routes with separate adapters for job sources, application forms, mailboxes, and notifications; keep matching and pre-authorization rules independent of provider adapters.
- `Storage` — use local SQLite through `better-sqlite3` for normalized profiles, listings, decisions, and the action history; keep secrets in `job-assistant/.env.local` and personal files in ignored `job-assistant/.local-data/`; do not sync them to a cloud service by default.
- `Résumé parsing` — support UTF-8 text and PDF initially, using `pdfjs-dist` for PDF text extraction; preserve source page references, surface uncertain or missing fields for correction, and reject unsupported files explicitly.
- `Profile validation` — require full name, a valid contact email, current location or an explicit remote-only selection, at least one target role, and at least one work-history or education entry; record work authorization as supplied, unknown, or prefer not to answer, and never infer it.
- `Upload limits` — accept `.txt` and `.pdf` files up to 10 MiB each and PDFs up to 30 pages; reject larger, encrypted, malformed, or unsupported files before persistence with a clear local error.
- `Web access` — develop first against saved listing and form fixtures; prefer official APIs, feeds, or exports; use Playwright only for a source whose terms and the user's authorization permit automation, and never bypass CAPTCHAs, robots restrictions, or access controls.
- `Mailbox and notification` — use local RFC 822 email fixtures and an in-app notification for initial tests; later provider adapters must use the provider's official read-only OAuth flow with least privilege after the user identifies and authorizes the mailbox and destination.
- `Submission policy` — support automatic submission without per-application review only when a user-created rule is enabled and versioned, the authorized source and job satisfy its declared predicates, every answer is truthfully sourced from confirmed profile data or explicitly included in that rule, no duplicate or prior attempt exists, and all site and rate constraints pass; otherwise stop before submission and request one decision. Record the rule revision, match trace, answer sources, idempotency key, timestamp, provider response, and receipt for every attempt.
- `Fixtures` — create synthetic profiles, résumés, job listings, forms, and interview and non-interview emails with no real credentials or personal data; use a fresh temporary SQLite database per test.
- `Commands` — from `job-assistant/`, require `npm test`, `npm run lint`, and `npm run build`; browser-adapter features additionally require `npm run test:e2e` against local fixtures with outbound network access disabled.
- `Local services` — the first feature uses no external service, account, paid API, live website, or mailbox; all dependencies and test data run locally.
- `Initialization` — before `plan-feature`, create Setup check with status `started`, then create revision 1 of Product status and Feature backlog from Current product status and Feature backlog at their declared runtime paths, record the loop revision and initialization time, and read both files back successfully; mark Setup check `passed` only after validation and do not enter the first state while it is absent, failed, or incomplete.
- `Workflow` — use one branch named `feat/ja-<id>-<short-name>` per feature, keep changes bounded to the Feature plan, and preserve a commit or draft pull request plus exact test commands for review; do not merge a feature with unresolved blocking tests.
- `Authority` — the user has authorized the product behavior of auto-submitting under pre-authorized rules, but has not supplied credentials or authorized any current live account, source, personal résumé transfer, external message, or paid service. Obtain those separate permissions before live access; once granted, do not interrupt for each application that satisfies the recorded rule in full.

### Import profile and résumé

**ID:** `first-profile-import`
**Role:** `first-work`
**Description:** The first bounded feature implements JA-001 with a local profile editor, safe résumé extraction, correction, validation, persistence, and automated acceptance tests.

#### Initial Contents

- `Feature` — implement `JA-001 — Import profile and résumé` in the isolated `job-assistant/` package; include only the minimal scaffold needed to run and test this user-visible flow.
- `Input` — use one synthetic profile and matching UTF-8 text and PDF résumé fixtures; accept typed profile fields and local `.txt` or `.pdf` upload without network transfer.
- `Extraction` — normalize contact details, work history, education, skills, links, and work authorization; attach source field or page provenance and mark uncertain or absent values instead of guessing.
- `Correction` — show extracted values in an editable review screen and persist only the user's confirmed version to a temporary or local SQLite database.
- `Validation` — require full name, valid contact email, location or remote-only selection, at least one target role, and at least one work-history or education entry; never infer work authorization; reject unsupported, encrypted, malformed, larger-than-10-MiB, or over-30-page PDF files with a clear error; keep secrets, raw résumé text, and personal values out of logs and test snapshots.
- `Acceptance tests` — prove equivalent normalized output for the paired text and PDF fixtures, correction persistence, each mandatory-field error, unknown work-authorization handling, unsupported and encrypted-file rejection, 10-MiB and 30-page boundary behavior, log redaction, and a successful production build.
- `Excluded work` — do not scrape websites, score jobs, connect an inbox, send an external notification, or submit an application in this feature.
- `Handoff` — produce a draft Pull request with the feature ID, baseline revision, code and test references, exact commands, completed, partial, failed, or blocked outcome, limitations, and follow-up findings.

## Artifacts

### Setup check

**ID:** `setup-check`
**Description:** The first runtime record at `.loopit/runtime/job-assistant/setup-check.md`. It carries the loop revision, attempt number, started and completed times, intended Product status and Feature backlog paths and source entries, each write and read-back check, completed or failed outcome, observable errors, safe repair attempted, and exact resume instruction. It never claims the proposed package, dependencies, fixtures, or commands exist until sandbox execution observes them.

### Product status

**ID:** `product-status`
**Description:** The durable record at `.loopit/runtime/job-assistant/product-status.md`, initialized before the first state from Current product status. It carries a monotonically increasing revision, loop revision, updated time, and source Product review, and lists each user-visible capability as not started, partial, failing, or implemented with the Pull request and Test results supporting every status change.

### Feature backlog

**ID:** `feature-backlog`
**Description:** The prioritized record at `.loopit/runtime/job-assistant/feature-backlog.md`, initialized before the first state from Feature backlog with revision 1 and the current loop revision. Every later item cites the objective requirement it advances, the Test results, observation, missing evidence, or explicit user scope change that caused it, why it remains unresolved and non-duplicative, and the evidence that would retire it.

### Feature plan

**ID:** `feature-plan`
**Description:** One bounded feature at `.loopit/runtime/job-assistant/features/<feature-id>/plan.md` containing its backlog link, product-status revision, user behavior, implementation scope, acceptance and failure cases, privacy and permission constraints, excluded work, intended files, and required tests.

### Pull request

**ID:** `pull-request`
**Description:** The portable software handoff for one Feature plan: a draft or ready pull request, or a local branch and commit when no remote is available, identifying the baseline and feature ID; code and diff; fixtures; run instructions; preliminary checks; completed, partial, failed, or blocked outcome; known limitations; unresolved findings; candidate follow-up work; and enough repository provenance for another developer to inspect it. Every attempt also creates `.loopit/runtime/job-assistant/features/<feature-id>/implementation-attempt.md`; when no branch, commit, or code exists, that file is the durable failed or blocked Pull request fallback and records the attempted actions and error evidence.

### Test results

**ID:** `test-results`
**Description:** The observed record at `.loopit/runtime/job-assistant/features/<feature-id>/test-results.md` linking the Feature plan and Pull request to the environment, exact commands, fixtures, outputs, passed and failed scenarios, regressions, limitations, and reproduction details; failed and blocked outcomes are valid records. Submission features also record the policy and rule revision, rule-match trace, answer provenance, idempotency result, whether submission was permitted or blocked, and any sandbox receipt. Initialization, fresh-session recovery, bounded retry, or release-routing checks record their observed artifact revisions and transition trace here or link the exact preflight report; no check is marked passed until sandbox execution produces that evidence.

### Product review

**ID:** `product-review`
**Description:** The review at `.loopit/runtime/job-assistant/product-review.md` interpreting the latest Pull request and Test results, recording the input and resulting Product status revisions and backlog changes, and selecting exactly one justified next outcome; a release candidate receives a unique candidate revision but is not an accepted release.

### Decision request

**ID:** `decision-request`
**Description:** One focused request at `.loopit/runtime/job-assistant/decision-request.md` stating the human-owned product, privacy, permission, provider, cost, risk, or scheduled-observation question, relevant evidence, recommendation, alternatives, and consequence of waiting. It records a unique request ID, open, resolved, or superseded status, originating state or runtime policy, feature ID when applicable, Product status or release-candidate revision, exact next state or runtime policy, allowed outcome transition IDs, and creation time; a newer request explicitly supersedes an older open request, and stale or mismatched requests are never consumed.

### User decision

**ID:** `user-decision`
**Description:** The user's recorded answer or authorized observation at `.loopit/runtime/job-assistant/user-decision.md`, including the matching request ID, candidate revision when applicable, exact authorized scope, decision time, and declared resume state and transition ID, so later development does not infer authority from chat history, silence, or a stale request.

### Release review

**ID:** `release-review`
**Description:** A runtime-dispatched fresh independent review at `.loopit/runtime/job-assistant/release-review.md`, created only after Product review declares a release-candidate revision. It compares that exact candidate with the agreed objective, Product status, Pull requests, and Test results and records blocking gaps, human-owned questions, optional nonblocking work, or a no-blocker verdict without claiming unobserved evidence; it cannot accept the release.

### Development checkpoint

**ID:** `development-checkpoint`
**Description:** The runtime-owned recovery record at `.loopit/runtime/job-assistant/checkpoint.md`, refreshed on every state entry and after every durable artifact write. It records the loop revision, active state, feature ID, attempt number, input artifact revisions, last completed artifact, last safe action, pending boundary, and exact resume state. On restart, a valid active checkpoint overrides the front-matter start state. If it is invalid, preserve it and write `.loopit/runtime/job-assistant/recovery-report.md` with the validation errors, artifact inventory, reconstruction decision, possible duplicate or external-action risk, and exact resume or pause instruction; never silently replace unresolved work with the front-matter start state.

## Boundaries

### Live access and personal data

**ID:** `live-access-boundary`
**Kind:** `interrupt`
**Description:** Pause before first use of personal credentials or résumé data outside the approved local store, connecting a live website or mailbox, accepting material site terms, sending a message, submitting or withdrawing through a newly connected account or source, or changing the scope of granted access. Never fabricate applicant facts or bypass CAPTCHAs, robots restrictions, rate limits, or access controls. After the user authorizes a specific account and source, an application that fully matches an enabled pre-authorized rule may submit without another per-application interrupt; a missing, expired, partial, or ambiguous rule match must pause. When this boundary fires during implementation or testing, the runtime saves the Development checkpoint, creates one open Decision request naming the active state, feature, input revisions, last safe action, and exact `decision-to-implement` or `decision-to-test` route, then enters Wait for user decision. A matching User decision resumes that same state; denial produces a blocked Pull request or Test results and follows the ordinary test and review handoffs.

### Product and risk decisions

**ID:** `product-decision-boundary`
**Kind:** `interrupt`
**Description:** The auto-submit policy is decided: rule-matched applications do not require per-application approval. Pause when development requires the actual rule contents, a change to that policy, job preferences, email or notification provider, a sensitive or unsourced application answer, acceptable false-positive rate, legal or site-policy interpretation, or another consequential choice that evidence cannot determine.

### Time or cost limit

**ID:** `development-budget-boundary`
**Kind:** `budget`
**Description:** Pause before purchasing a service, incurring API or cloud cost, or exceeding a user-declared time or compute limit. Preserve the current plan, code, test evidence, and Development checkpoint. If authorization could change the outcome, create one Decision request with the active state, feature, amount or resource, input revisions, and exact `decision-to-implement` or `decision-to-test` route, then enter Wait for user decision. A matching authorization resumes after the last safe action; denial produces a blocked Pull request or Test results and continues through testing and review without repeating external actions.

### Setup failure

**ID:** `setup-failure-boundary`
**Kind:** `interrupt`
**Description:** If initialization cannot create or read back Product status and Feature backlog, Setup check records the failed write or validation, error, attempt number, and proposed safe repair. The runtime may repair missing directories, atomic-write interruption, or schema formatting and rerun initialization at most twice. A persistent agent-owned failure remains paused with the exact failed check; a permission, storage, or authority issue creates one Decision request whose origin and resume policy are `initialization`, allows `decision-to-initialized-plan`, and enters Wait for user decision. After a matching User decision, that transition reruns Setup check from the failed operation and enters `plan-feature` only after setup passes and the first Development checkpoint is saved.

### Interrupted session recovery

**ID:** `session-recovery-boundary`
**Kind:** `interrupt`
**Description:** On interruption, preserve the Development checkpoint and partial native deliverable. On restart, verify its required fields, loop revision, state ID, feature ID, artifact revisions, and last safe action. A valid active checkpoint resumes its recorded state. If the checkpoint is missing or invalid after setup has begun, inspect open Decision request, Feature plans, Pull request fallbacks or branches and commits, Test results, Product reviews, Release review, and User decision in revision order: an open request resumes waiting; a plan without a Pull request resumes implementation; a Pull request without Test results resumes testing; Test results not yet cited by Product review resume review; a release candidate resumes challenge or confirmation according to its matching review and decision; a fully integrated review with ready backlog work resumes planning. Reconstruct and atomically replace the checkpoint only when exactly one state follows from consistent artifacts. If artifacts conflict, more than one state is plausible, or an external action may already have occurred, preserve them, write a paused recovery report and one Decision request describing the risk, and do not resume or repeat the action until matching input resolves it. Use `plan-feature` only when Setup check passed and no feature, result, review, open decision, or candidate artifact exists, or when the prior checkpoint is explicitly closed.

### Retry limit

**ID:** `retry-limit-boundary`
**Kind:** `interrupt`
**Description:** Retry a transient tool or local-service failure at most twice with the same Feature plan and inputs, recording each attempt, error, and delay in the Development checkpoint. After two failed implementation retries, create a failed or blocked Pull request fallback and take `implement-to-test`; Test feature then records what can be inspected. After two failed testing retries, create blocked Test results and take `test-to-review`. Never bypass Test feature or Review and update backlog. Any further attempt requires a materially changed plan or evidence, or one explicit User decision; deterministic test failures are never retried unchanged.

### Accepted release

**ID:** `accepted-release-boundary`
**Kind:** `complete`
**Description:** Finish only when a fresh independent Release review finds no blocking gap in the agreed scope and the user explicitly accepts the release; optional enhancements remain in the Feature backlog without silently expanding the objective.

## States

### Plan feature

**ID:** `plan-feature`
**Kind:** `decide`
**Summary:** Choose one justified job-assistant feature and define its behavior, safety limits, and acceptance tests.

#### Reads

- Product status
- Feature backlog
- Development setup
- Import profile and résumé
- User decision

#### Instruction

Before planning, require initialized, readable Product status and Feature backlog artifacts and use their recorded revisions. User decision is optional: consume it only when it matches an open Decision request whose origin, revision, resume state, and transition ID all point to `plan-feature`; ignore absent, resolved, stale, or mismatched decisions. On the first iteration, select JA-001 and use Import profile and résumé as the exact task. On later iterations, compare Product status and Feature backlog with the objective and choose the highest-priority unresolved item that is safe and feasible within current authority. Confirm that the item names the objective requirement it advances, its triggering evidence, why it remains unresolved and non-duplicative, and the evidence that would retire it. Write one Feature plan with bounded user behavior, the exact Product status revision, implementation scope, acceptance and failure cases, privacy and permission constraints, excluded work, expected Pull request, and exact tests. A submission feature must treat automatic submission under enabled pre-authorized rules as required behavior and test refusal outside those rules. If credentials, live access, actual rule contents, spending, personal preference, or another consequential decision is required, write one Decision request with its origin and exact resume transition instead of assuming it.

#### Writes

- Feature plan
- Decision request

#### Completion

Either one Feature plan is executable from the recorded setup without hidden context, or one focused Decision request identifies the human-owned input required before planning can finish.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `implement-feature` | The Feature plan is bounded, authorized, and testable | `normal` | `plan-to-implement` |
| `wait-for-decision` | Planning requires credentials, live access, spending, personal preference, or another human-owned decision | `interrupt` | `plan-to-decision` |

### Implement feature

**ID:** `implement-feature`
**Kind:** `act`
**Summary:** Build the planned job-assistant behavior and preserve an inspectable code change.

#### Reads

- Feature plan
- Development setup
- User decision

#### Instruction

User decision is optional: consume it only when a live-access or budget Decision request names this feature, `implement-feature`, the current input revisions, and `decision-to-implement`. Matching authorization resumes after the recorded last safe action; matching denial creates a blocked Pull request fallback and takes `implement-to-test`; ignore absent, stale, or mismatched decisions. Implement only the selected Feature plan in the isolated package, preserving unrelated repository changes. Add focused automated tests and fixtures as part of the code change. Use local fixtures or explicitly approved integrations, enforce the recorded privacy and permission limits, and do not broaden scope after seeing difficulties. Always create the durable implementation-attempt file for the Pull request. Link the Feature plan and prior Product status revision; identify the branch, commit or diff when one exists; record fixtures, run instructions, preliminary checks, outcome as completed, partial, failed, or blocked, known limitations, unresolved findings, candidate follow-ups, and provenance. If failure occurs before code or a commit exists, record attempted actions and observable errors in that fallback file. The runtime applies the bounded Retry limit and updates the Development checkpoint without adding recovery transitions to this domain state. A failed, denied, or blocked attempt remains a valid Pull request handoff and takes `implement-to-test`.

#### Writes

- Pull request

#### Completion

A fresh developer can inspect the code change and preliminary evidence, or the durable Pull request fallback records a partial, failed, or blocked attempt with enough detail to reproduce or diagnose it.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `test-feature` | A Pull request records the implementation attempt and its outcome | `normal` | `implement-to-test` |

### Test feature

**ID:** `test-feature`
**Kind:** `evaluate`
**Summary:** Exercise the feature against its acceptance, failure, privacy, duplicate-action, and permission scenarios.

#### Reads

- Feature plan
- Pull request
- Development setup
- User decision

#### Instruction

User decision is optional: consume it only when a live-access or budget Decision request names this feature, `test-feature`, the current input revisions, and `decision-to-test`. Matching authorization resumes after the recorded last safe action; matching denial writes blocked Test results and takes `test-to-review`; ignore absent, stale, or mismatched decisions. Independently run every declared acceptance test and the relevant regression, failure, privacy, truthfulness, idempotency, and authority checks. For submission features, prove automatic submission for a fully matched enabled rule and refusal for missing, disabled, expired, partial, ambiguous, unsourced-answer, duplicate, denied-access, and replay cases, while recording the exact policy revision and sandbox receipt. Use deterministic local fixtures unless a live integration has been explicitly authorized. Record only observed evidence in Test results: environment, exact commands, fixture and code references, outputs, pass or fail for each scenario, regressions, limitations, and reproduction steps. If no runnable implementation exists or authorization was denied, inspect the Pull request fallback and record why evaluation cannot continue. Keep candidate bugs and follow-ups in Test results for product review; do not add them to the backlog automatically. After the bounded Retry limit, write blocked Test results and take `test-to-review`.

#### Writes

- Test results

#### Completion

Test results contain a completed, partial, failed, or blocked verdict, observed evidence for every test that could run, explicit missing evidence, and enough provenance for a fresh reviewer.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `review-and-update` | Test results record the evaluated outcome, including any failure or block | `normal` | `test-to-review` |

### Review and update backlog

**ID:** `review-and-update`
**Kind:** `update`
**Summary:** Interpret the code and tests, update product truth, and justify the next feature or release decision.

#### Reads

- Product status
- Feature backlog
- Feature plan
- Pull request
- Test results
- User decision
- Release review

#### Instruction

Consume User decision only when it matches a resolved Decision request whose candidate or Product status revision and allowed inbound transition target `review-and-update`; this includes `decision-to-review` and `confirm-to-review` regardless of whether the request originated in product review, release challenge, or release confirmation. Otherwise treat its absence as normal and ignore stale or mismatched decisions. Release review is also optional: consume it only when `challenge-release` returned the matching release-candidate revision to this state; treat absence as normal and reject stale or mismatched reviews. Review the Pull request and Test results against the Feature plan, or integrate the returned Release review blocker or rejected release when this is a completion return. Update Product status only with observed behavior, increment its revision, and cite the evidence for every change. Mark the selected backlog item done only when its retirement evidence exists. Add, split, retain, or reprioritize a backlog item only when it cites the objective requirement it advances; the Test results, observation, failed check, missing evidence, explicit User decision, or matching Release review that caused it; why it remains unresolved and is not a duplicate; and the evidence that would retire it. Candidate follow-ups enter the backlog only when they satisfy this rule.

Then compare the complete Product status and Feature backlog with the objective and record exactly one Product review outcome: one or more ready objective-backed backlog items; a scheduled observation with a date or trigger when an external change is expected; one human-owned Decision request; or a release candidate supported by the declared evidence and assigned a unique candidate revision. Never stop because the current queue is empty, and never invent unrelated work merely to keep the loop moving. A scheduled observation or human-owned decision goes to the declared boundary. Integration only creates the candidate; it does not create or consume Release review and cannot accept completion. The runtime sends a release candidate to `challenge-release` for independent review.

#### Writes

- Product status
- Feature backlog
- Product review
- Decision request

#### Completion

The latest result is integrated, every status and backlog change is traceable, and Product review records exactly one justified next outcome that another session can follow without hidden context.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `plan-feature` | Product review leaves one or more justified, ready Feature backlog items | `continue` | `review-to-plan` |
| `wait-for-decision` | Product review selects a scheduled observation or one human-owned decision and no authorized feature can continue first | `interrupt` | `review-to-decision` |
| `challenge-release` | Product review declares a release candidate with a unique candidate revision and supporting evidence | `normal` | `review-to-challenge` |

### Wait for user decision

**ID:** `wait-for-decision`
**Kind:** `interrupt`
**Summary:** Pause for one product, privacy, provider, permission, risk, cost, or scheduled-observation input.

#### Reads

- Decision request
- Product status
- Feature backlog

#### Instruction

Verify that Decision request is open and records its originating state, feature or candidate revision, and exact resume state and transition ID. Present that one focused question or scheduled observation with the relevant evidence, recommendation, alternatives, cost or risk, and consequence of waiting. Do not infer authority from silence and do not broaden the user's permission. Record a matching request ID, authorization scope, date, and exact route in User decision; mark the request resolved when consumed, and ignore or explicitly supersede stale requests.

#### Writes

- User decision

#### Completion

The requested decision, authorization, or observation is recorded with its scope, source, and date, or the loop remains paused at the boundary.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `plan-feature` | The initialization Decision request and matching User decision allow `decision-to-initialized-plan`, and the rerun Setup check passes before entry | `normal` | `decision-to-initialized-plan` |
| `plan-feature` | The Decision request originated in feature planning and the User decision makes planning possible | `normal` | `decision-to-plan` |
| `implement-feature` | The runtime boundary request originated in implementation and the matching User decision either authorizes resumption or denies access and requires a blocked Pull request fallback | `normal` | `decision-to-implement` |
| `test-feature` | The runtime boundary request originated in testing and the matching User decision either authorizes resumption or denies access and requires blocked Test results | `normal` | `decision-to-test` |
| `review-and-update` | The Decision request originated in product review or release challenge and the matching User decision or scheduled observation is ready to integrate | `normal` | `decision-to-review` |

### Challenge release

**ID:** `challenge-release`
**Kind:** `challenge`
**Summary:** Independently test the proposed job-assistant release against its agreed scope and recorded evidence.

#### Reads

- Product status
- Feature backlog
- Product review
- Pull request
- Test results

#### Instruction

The runtime starts this state only for the release-candidate revision named by Product review and dispatches a fresh reviewer that did not produce the candidate. Compare every agreed capability and safety constraint with cited Pull requests and Test results, inspect edge cases and missing evidence, and write Release review without rerunning or inventing product evidence. Classify each finding as an agent-owned blocking backlog item, a human-owned question, or optional nonblocking work, then apply deterministic precedence. If any agent-owned blocker exists, take `challenge-to-review`; preserve human questions in Release review so product review can issue one later if it still matters. Otherwise, if any human-owned question remains, write one Decision request with origin `challenge-release`, the candidate revision, and allowed route `decision-to-review`, then take `challenge-to-decision`. Only when neither blocker nor human question remains may optional work stay nonblocking; write one acceptance Decision request naming next state `confirm-release` and allowed outcomes `confirm-to-release` and `confirm-to-review`.

#### Writes

- Release review
- Decision request

#### Completion

Release review names the exact candidate revision, has an independent evidence-backed verdict, applies blocker-before-question-before-acceptance precedence, and selects exactly one route without approving the release itself.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `review-and-update` | Release review finds one or more agent-owned blocking gaps | `normal` | `challenge-to-review` |
| `wait-for-decision` | Release review requires one human-owned product, permission, or risk decision | `interrupt` | `challenge-to-decision` |
| `confirm-release` | Release review finds no blocking gap and the matching acceptance Decision request is ready | `interrupt` | `challenge-to-confirm` |

### Confirm release

**ID:** `confirm-release`
**Kind:** `interrupt`
**Summary:** Ask the user whether to accept the independently reviewed job-assistant release.

#### Reads

- Product review
- Release review
- Decision request

#### Instruction

Verify that Product review, Release review, and the open Decision request name the same current candidate revision, that Release review has no blocking gap, and that the request allows both `confirm-to-release` and `confirm-to-review`. Present the scoped release, supporting evidence, known limitations, and optional nonblocking backlog items, then ask only whether to accept that candidate or return a stated blocking concern to development. Record the matching request ID, candidate revision, explicit answer, and selected transition as User decision, and update Decision request to `resolved`; silence is not acceptance. On rejection, preserve the reason and route `confirm-to-review` without rewriting the request's origin or candidate revision.

#### Writes

- User decision
- Decision request

#### Completion

The user explicitly accepts the exact challenged candidate or records a blocking concern for product review; otherwise the loop remains paused.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `release-accepted` | The matching independent completion challenge has no blocking gap and the User decision explicitly accepts the current candidate revision | `complete` | `confirm-to-release` |
| `review-and-update` | The resolved acceptance Decision request and matching User decision select `confirm-to-review` because the user rejects the candidate or supplies a blocking concern | `normal` | `confirm-to-review` |

### Release accepted

**ID:** `release-accepted`
**Kind:** `terminal`
**Summary:** Preserve the independently reviewed and user-accepted job-assistant release, then stop.

#### Reads

- Product status
- Feature backlog
- Product review
- Release review
- Test results
- User decision

#### Instruction

Record the accepted scope, explicit user confirmation, Release review verdict, supporting Pull requests and Test results, known limitations, and optional nonblocking backlog items in Product review so a fresh developer can understand exactly what was accepted.

#### Writes

- Product review

#### Completion

The accepted release and its evidence are saved without claiming unobserved behavior or discarding optional follow-up work.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
