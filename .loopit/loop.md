---
loopit: 1
revision: 5
status: draft
completion-policy: confirm
start: ensure-workspace
---

# Build a user-controlled job application agent

## Objective

Build and validate a privacy-conscious assistant that uses a user-provided profile and resume to discover and rank jobs from authorized sources, automatically submits applications only when they fit explicit user-approved rules and require no invented facts or new commitments, records submission receipts, monitors an authorized mailbox for interview-related messages, and notifies the user through a configured channel. Completion requires current end-to-end sandbox or explicitly approved-live evidence for discovery, matching, deduplication, safe submission, receipt tracking, interview-message detection, notification delivery, privacy, fresh-session resumption, and recovery from injected tool, missing-evidence, interrupted-write, retry-exhaustion, refusal, and finalization failures, followed by an actually fresh challenge and explicit human acceptance.

## Artifacts

### Workspace scaffolds

**ID:** `workspace-scaffolds`
**Kind:** `scaffold`
**Description:** The first-pass structure: `.loopit/job-agent/`, `job-agent/manifest.md`, `job-agent/src/`, `job-agent/tests/`, `job-agent/fixtures/`, and schema-1 templates for `product-policy.md`, `evidence.md`, `backlog.md`, `control.md`, and `final.md`. It is valid when every declared path exists, manifests name runtime/build/test commands or mark them `unresolved`, fixtures are synthetic, control templates contain every boundary-record heading named below, and no secret value is stored.

### Product frontier

**ID:** `product-frontier`
**Kind:** `durable-state`
**Description:** The version-0 record at `.loopit/job-agent/frontier.md`, written only by first-pass initialization with `Schema`, `Frontier version`, objective-criterion statuses, unresolved items, queued human decisions, retry counters, risks, evidence references, and one next-priority rationale. It is valid when version is 0, every criterion and frontier item has an ID and status, counters are nonnegative, and references resolve or are explicitly `none`.

### Updated product frontier

**ID:** `updated-product-frontier`
**Kind:** `durable-state`
**Description:** The version-1-or-later successor at `.loopit/job-agent/frontier.md`, written only by `update-product-frontier` from an evaluated delta or boundary input. It uses the Product frontier schema, increments the base version exactly once, preserves evidence references and retry history, and becomes the sole authoritative frontier for the next selection.

### Selected work contract

**ID:** `selected-work-contract`
**Kind:** `work-contract`
**Description:** `.loopit/job-agent/current-work.md` with `Schema: 1`, unique work-item ID, source frontier version, selected gap and rationale, permitted bounded action, input references, safety boundaries, expected `Work result and evidence`, and acceptance checks. It is valid when one unresolved frontier item is named, all inputs resolve, authority is sufficient, and checks are observable.

### Work result and evidence

**ID:** `work-result-and-evidence`
**Kind:** `evidence`
**Description:** `.loopit/job-agent/work-result.md` plus referenced append-only entries in `evidence.md`, with work-item ID, `Outcome: success|failure|blocked`, changes or attempted action, commands and observations, receipt or artifact references, redactions, failure signature or `none`, and produced-at time. Expected implementation or test failures are valid outcomes; the record is invalid only when required fields or referenced evidence are missing.

### Evaluation and frontier delta

**ID:** `evaluation-and-frontier-delta`
**Kind:** `evaluation`
**Description:** `.loopit/job-agent/evaluation.md` with work-item ID, source frontier version, evidence IDs, verdict, ownership classification, resolved/retained/added frontier items, retry-counter changes, optional-backlog additions, proposed next frontier, and exactly one next-route classification: `continue|human|candidate`. It is valid when every judgment cites evidence and the proposed frontier is a complete deterministic successor to its base.

### Saved checkpoint and recovery record

**ID:** `saved-checkpoint`
**Kind:** `recovery-state`
**Description:** `.loopit/job-agent/checkpoint.md` with `Schema: 1`, current state ID, resume state ID, work-item ID or `none`, phase `started|writing|verified|idle`, expected record name and path, same-signature recovery attempts `0..2`, alternate recovery attempts `0..1`, and last recovery evidence ID or `none`. Recovery evidence is appended to `evidence.md`; the checkpoint is valid when IDs exist in this loop, counters are in range, and a verified expected record passes its artifact schema.

### Completion and boundary records

**ID:** `boundary-records`
**Kind:** `control-state`
**Description:** Exact named sections in `.loopit/job-agent/control.md`: `Human decision request`, `Human decision`, `Completion candidate`, `Completion challenge`, `Human acceptance or blocking thought`, `Pause record`, and `Human resume instruction or authority change`. `.loopit/job-agent/final.md` stores `Final accepted record` and its finalization evidence reference. Each record is valid only when its cited frontier, work-item, evidence, challenge, or decision IDs resolve.

## Boundaries

### Human authority required

**ID:** `human-authority`
**Kind:** `interrupt`
**Description:** Stop and ask one focused question when work needs missing user intent, a profile fact, sensitive information, credentials, source or mailbox permission, risk policy, an application answer or commitment, CAPTCHA handling, or any live external action not already covered by explicit user-approved rules. Never fabricate an answer, bypass access controls, or assume permission.

### Challenged product accepted

**ID:** `accepted-product`
**Kind:** `complete`
**Description:** The declared evidence supports the scoped objective, a fresh challenge finds no blocking gap, and the user explicitly accepts the result; completing a slice, prototype, or first successful application is not project completion.

### Construction paused

**ID:** `construction-pause`
**Kind:** `interrupt`
**Description:** Stop without claiming completion after an explicit pause, refusal or revocation that leaves no authorized work, exhausted bounded recovery with no safe alternative, or an empty frontier whose next scope requires human intent; preserve the reason and exact resume question.

## States

### Ensure the durable workspace

**ID:** `ensure-workspace`
**Kind:** `act`
**Summary:** Perform first-pass scaffold and durable-state initialization only.

#### Reads

- Artifact contracts in this loop
- Workspace scaffolds, if present
- Product frontier, if present
- Saved checkpoint, if present

#### Instruction

On the first pass, inspect the declared paths, write a Saved checkpoint naming `ensure-workspace`, create only missing Workspace scaffolds, initialize Product frontier version 0, and re-read them against their schemas. Mark human-owned policy fields `unresolved`; do not invent profile facts, permissions, credentials, preferences, or acceptance thresholds. Do not select work, create a work contract, perform implementation, record action evidence or failures, evaluate results, update a frontier, or write human control records here. If a checkpoint, scaffold write, or initialized durable record is missing, partial, corrupt, or permission-blocked, hand it to `recover-interrupted`.

#### Writes

- Workspace scaffolds
- Product frontier
- Saved checkpoint

#### Completion

Workspace scaffolds, Product frontier, and Saved checkpoint re-read as valid, or one initialization interruption has an explicit recovery route.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `select-product-gap` | Workspace scaffolds, Product frontier, and Saved checkpoint all validate | `normal` | `ensure-to-select` |
| `recover-interrupted` | A checkpoint, scaffold write, or initialized durable record is missing, partial, corrupt, or interrupted | `normal` | `ensure-to-recover` |

### Recover interrupted state

**ID:** `recover-interrupted`
**Kind:** `update`
**Summary:** Repair only corrupted checkpoints, interrupted writes, or missing expected records, then resume the checkpointed state.

#### Reads

- Saved checkpoint
- Expected record named by Saved checkpoint, if present
- Workspace scaffolds

#### Instruction

Do not select, implement, evaluate, or update product work. Inspect only the Saved checkpoint and its named expected record. Preserve valid partial data, quarantine invalid partial data by reference, and repair the checkpoint or structural record so the named resume state can safely repeat its own idempotent work. Permit at most two same-signature repairs and one materially different safe repair. Append Recovery evidence for every attempt. Expected implementation or test failure with a valid Work result and evidence is not recoverable corruption and must go to `evaluate-slice`. After repair, retain the saved resume state and return exactly there. If no authorized repair exists, mark the bounded recovery allowance exhausted without attempting unauthorized work; only exhausted recovery creates one Human decision request.

#### Writes

- Saved checkpoint
- Recovery evidence
- Repaired expected record under its original artifact name
- Human decision request

#### Completion

The checkpoint and expected record validate for exactly one saved resume state, or bounded recovery exhaustion has one evidence-backed Human decision request.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `ensure-workspace` | Saved checkpoint names `ensure-workspace` and initialization structures are repaired | `normal` | `recover-to-ensure` |
| `select-product-gap` | Saved checkpoint names `select-product-gap` and its frontier input is valid | `normal` | `recover-to-select` |
| `build-bounded-slice` | Saved checkpoint names `build-bounded-slice` and Selected work contract is valid | `normal` | `recover-to-build` |
| `evaluate-slice` | Saved checkpoint names `evaluate-slice` and Work result and evidence is valid | `normal` | `recover-to-evaluate` |
| `update-product-frontier` | Saved checkpoint names `update-product-frontier` and its incoming delta or boundary record is valid | `normal` | `recover-to-update` |
| `challenge-completion` | Saved checkpoint names `challenge-completion` and Completion candidate is valid | `normal` | `recover-to-challenge` |
| `human-decision` | Saved checkpoint names `human-decision` and Human decision request is repaired and valid | `interrupt` | `recover-to-human-state` |
| `confirm-completion` | Saved checkpoint names `confirm-completion` and Completion challenge is valid | `normal` | `recover-to-confirm` |
| `finalize-product` | Saved checkpoint names `finalize-product` and the blocker-free challenged candidate plus accepted confirmation inputs are valid | `normal` | `recover-to-finalize` |
| `construction-pause` | Saved checkpoint names `construction-pause` and Pause record is valid | `interrupt` | `recover-to-pause` |
| `human-decision` | Bounded recovery is exhausted and one evidence-backed Human decision request validates | `interrupt` | `recover-exhausted-to-human` |

### Select the next product gap

**ID:** `select-product-gap`
**Kind:** `decide`
**Summary:** Turn the authoritative frontier into one bounded Selected work contract.

#### Reads

- Product frontier
- Updated product frontier
- Saved checkpoint

#### Instruction

Use Product frontier only on the first pass; once Updated product frontier exists, it is the sole authoritative input. Save a checkpoint naming `select-product-gap`. Choose one unresolved, agent-owned frontier item and write one Selected work contract with its bounded action, authority, safety limits, expected Work result and evidence, and observable checks. If no safe agent-owned item can proceed because human intent, facts, permission, credentials, or risk policy are missing, write one Human decision request. If every criterion has current evidence and no blocker, write only a Completion candidate. A missing or interrupted expected record routes to recovery, not initialization.

#### Writes

- Selected work contract
- Human decision request
- Completion candidate
- Saved checkpoint

#### Completion

Exactly one valid Selected work contract, Human decision request, or Completion candidate is recorded with a verified Saved checkpoint.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `build-bounded-slice` | Selected work contract validates | `normal` | `select-to-build` |
| `human-decision` | Human decision request validates and no safe agent-owned item can proceed | `interrupt` | `select-to-human` |
| `challenge-completion` | Completion candidate validates against every scoped criterion | `normal` | `select-to-challenge` |
| `recover-interrupted` | Saved checkpoint, Selected work contract, Human decision request, or Completion candidate is missing, partial, or corrupt | `normal` | `select-to-recover` |

### Build and verify one bounded slice

**ID:** `build-bounded-slice`
**Kind:** `act`
**Summary:** Execute the Selected work contract and hand off one Work result and evidence record.

#### Reads

- Selected work contract
- Saved checkpoint

#### Instruction

Save a checkpoint naming `build-bounded-slice`, then perform only the bounded action in Selected work contract and run its declared checks. Prefer fixtures, mocks, and sandbox accounts until live access is explicitly authorized. For runtime-only criteria, perform the named sandbox action or failure injection and record what actually happened. Never invent profile claims, expose secrets, scrape disallowed sources, evade access controls, bypass CAPTCHAs, or exceed submission authority. Always write Work result and evidence: success, an expected product or test failure, a blocked action, and an ordinary tool-command failure are all valid outcomes and must continue to evaluation. Route to recovery only when the Saved checkpoint or required Work result and evidence record itself is missing, partial, or corrupt.

#### Writes

- Work result and evidence
- Saved checkpoint

#### Completion

Work result and evidence validates for the work-item ID and contains observable evidence for its success, failure, or blocked outcome.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `evaluate-slice` | Work result and evidence validates for any outcome, including implementation, test, or tool-command failure | `normal` | `build-to-evaluate` |
| `recover-interrupted` | Saved checkpoint or Work result and evidence is missing, partial, or corrupt after an interrupted write or ended turn | `normal` | `build-to-recover` |

### Evaluate the slice evidence

**ID:** `evaluate-slice`
**Kind:** `evaluate`
**Summary:** Convert Work result and evidence into one Evaluation and frontier delta.

#### Reads

- Work result and evidence
- Saved checkpoint

#### Instruction

Save a checkpoint naming `evaluate-slice`. Judge Work result and evidence against the acceptance checks embedded in that record, then write one Evaluation and frontier delta containing the complete proposed successor frontier. Treat success, product failure, test failure, blocked work, and recorded tool-command failure as evidence. Classify every finding as agent-owned blocking work, a human-owned decision, or optional follow-up. Agent-owned blockers and safe remaining work produce `continue`; when no safe agent work exists, one necessary human choice produces `human`; only current evidence for every criterion with no blocker produces `candidate`. External submissions require receipts, notifications require delivery evidence, and runtime recovery requires the observed declared route. Missing or corrupted records route to recovery; hypothetical evidence never passes.

#### Writes

- Evaluation and frontier delta
- Human decision request
- Completion candidate
- Saved checkpoint

#### Completion

Evaluation and frontier delta validates, cites every judgment, and selects exactly one route classification; any corresponding Human decision request or Completion candidate also validates.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-product-frontier` | Evaluation and frontier delta validates with route `continue` | `normal` | `evaluate-to-update` |
| `human-decision` | Evaluation and frontier delta selects `human` and one Human decision request validates | `interrupt` | `evaluate-to-human` |
| `challenge-completion` | Evaluation and frontier delta selects `candidate` and Completion candidate validates | `normal` | `evaluate-to-challenge` |
| `recover-interrupted` | Saved checkpoint, Evaluation and frontier delta, or its required route record is missing, partial, or corrupt | `normal` | `evaluate-to-recover` |

### Update the product frontier

**ID:** `update-product-frontier`
**Kind:** `update`
**Summary:** Apply one evaluated delta or boundary decision and persist Updated product frontier.

#### Reads

- Evaluation and frontier delta
- Completion challenge
- Human decision
- Human acceptance or blocking thought
- Human resume instruction or authority change
- Saved checkpoint

#### Instruction

Save a checkpoint naming `update-product-frontier`. Read exactly the record supplied by the incoming path: Evaluation and frontier delta on the ordinary route, Completion challenge after a challenger blocker, Human decision after a human interrupt, Human acceptance or blocking thought after declined confirmation, or Human resume instruction or authority change after pause. Apply it once to the cited frontier version, preserve evidence and retry history, append optional ideas only to the backlog, and write the complete Updated product frontier. Permit at most two same-signature work retries followed by one materially different safe action; exhaustion produces one Human decision request or Pause record, never an implicit stop. A bare rejection remains an unresolved human-owned decision. Select exactly one route with precedence: interrupted durable write to recovery; explicit pause or essential refusal/revocation to pause; otherwise unavoidable human choice; otherwise supported completion candidate; otherwise active frontier to selection.

#### Writes

- Updated product frontier
- Human decision request
- Completion candidate
- Pause record
- Saved checkpoint

#### Completion

Updated product frontier increments the cited base version exactly once, re-reads successfully, and yields exactly one active, human, candidate, or paused route record.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `select-product-gap` | Updated product frontier is active and contains one next-priority rationale | `continue` | `update-to-select` |
| `human-decision` | Updated product frontier requires one Human decision request and no pause condition applies | `interrupt` | `update-to-human` |
| `challenge-completion` | Updated product frontier has no blocker and Completion candidate validates | `normal` | `update-to-challenge` |
| `construction-pause` | Updated product frontier is paused and Pause record validates | `interrupt` | `update-to-pause` |
| `recover-interrupted` | Saved checkpoint or Updated product frontier is missing, partial, corrupt, or not exactly one version beyond its base | `normal` | `update-to-recover` |

### Challenge candidate completion

**ID:** `challenge-completion`
**Kind:** `challenge`
**Summary:** Let a fresh agent try to disprove that the scoped job assistant is ready.

#### Reads

- Completion candidate
- Saved checkpoint

#### Instruction

Save a checkpoint naming `challenge-completion`, then start a separately identified fresh agent session using the objective and evidence references in Completion candidate. Record actual isolation or launch-failure evidence. Try to disprove every scoped criterion, including matching, duplicates, factual accuracy, submission authority and receipts, privacy, mailbox classification, notification delivery, fresh-session recurrence, and injected recovery failures. Write one Completion challenge that classifies every finding as agent-owned blocker, human-owned decision, or optional follow-up. A launch failure is an agent-owned blocker. Agent blockers return through frontier update, human-owned blockers create one Human decision request, and only a blocker-free challenge proceeds to confirmation. A missing or interrupted challenge record routes to recovery.

#### Writes

- Completion challenge
- Human decision request
- Saved checkpoint

#### Completion

Completion challenge validates, cites fresh-session isolation or launch-failure evidence, classifies every finding, and selects exactly one blocker, human, or confirm route.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-product-frontier` | Completion challenge records any agent-owned blocker or launch failure | `normal` | `challenge-to-update` |
| `human-decision` | Completion challenge records no agent blocker and one Human decision request validates | `interrupt` | `challenge-to-human` |
| `confirm-completion` | Completion challenge is blocker-free and every declared evidence check passes | `interrupt` | `challenge-to-confirm` |
| `recover-interrupted` | Saved checkpoint or Completion challenge is missing, partial, or corrupt | `normal` | `challenge-to-recover` |

### Request one human decision

**ID:** `human-decision`
**Kind:** `interrupt`
**Summary:** Ask for the one human-owned input or authority decision needed to continue construction safely.

#### Reads

- Human decision request
- Saved checkpoint

#### Instruction

Present exactly the one question in Human decision request with its evidence, safest default, and consequences. Request secure references rather than secret values. Silence keeps the interrupt pending and grants no permission. When an answer, refusal, revocation, or pause request arrives, save a checkpoint naming `human-decision` and write one non-secret Human decision. If recording is interrupted, route to recovery.

#### Writes

- Human decision
- Saved checkpoint

#### Completion

Human decision validates against the request and records an answer, refusal, revocation, or pause request without exposing secrets.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-product-frontier` | Human decision validates | `normal` | `human-to-update` |
| `recover-interrupted` | An answer exists but Saved checkpoint or Human decision is missing, partial, or corrupt | `normal` | `human-to-recover` |

### Confirm challenged completion

**ID:** `confirm-completion`
**Kind:** `interrupt`
**Summary:** Ask the user once whether to accept the blocker-free challenged candidate or reopen scoped work.

#### Reads

- Completion challenge
- Saved checkpoint

#### Instruction

Present the candidate, cited evidence, fresh-session isolation evidence, challenger verdict, assumptions, and optional follow-ups contained in Completion challenge. Ask exactly one question: accept, or decline with an optional blocking thought. Silence is not acceptance. Save a checkpoint naming `confirm-completion`, then write Human acceptance or blocking thought without inventing a reason for a bare decline.

#### Writes

- Human acceptance or blocking thought
- Saved checkpoint

#### Completion

The user explicitly accepts or declines the challenged candidate, and the response is durably recorded without inventing a reason.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `finalize-product` | The user explicitly accepts the blocker-free challenged candidate and the acceptance record re-reads successfully | `normal` | `confirm-to-finalize` |
| `update-product-frontier` | The user declines acceptance, with or without a blocking thought, and the response re-reads successfully | `normal` | `confirm-to-update` |
| `recover-interrupted` | A response exists but Saved checkpoint or Human acceptance or blocking thought is missing, partial, or corrupt | `normal` | `confirm-to-recover` |

### Finalize the accepted record

**ID:** `finalize-product`
**Kind:** `update`
**Summary:** Persist and verify the accepted outcome before entering the terminal state.

#### Reads

- Human acceptance or blocking thought
- Saved checkpoint

#### Instruction

Save a checkpoint naming `finalize-product`. Follow the accepted decision's challenge and evidence references, write Final accepted record with the accepted scope, assumptions, user-owned activation steps, optional follow-ups, and finalization evidence ID, then re-read it. An absent or interrupted final record routes to recovery and is never terminal completion.

#### Writes

- Final accepted record
- Saved checkpoint

#### Completion

Final accepted record validates and resolves to the blocker-free challenge, explicit acceptance, and finalization evidence.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `product-complete` | Final accepted record re-reads and validates | `complete` | `finalize-to-complete` |
| `recover-interrupted` | Saved checkpoint or Final accepted record is missing, partial, or corrupt | `normal` | `finalize-to-recover` |

### Construction paused

**ID:** `construction-pause`
**Kind:** `interrupt`
**Summary:** Preserve an explicit, resumable pause without claiming the product is complete.

#### Reads

- Pause record
- Saved checkpoint

#### Instruction

Expose Pause record and its exact resume condition. Silence keeps this interrupt pending. When a complete resume instruction or authority change arrives, save a checkpoint naming `construction-pause` and write Human resume instruction or authority change for frontier update. If the user indicates resume but one material choice is missing, write one Human decision request. Perform no product work or external action here; interrupted recording routes to recovery.

#### Writes

- Human resume instruction or authority change
- Human decision request
- Saved checkpoint

#### Completion

The pause remains pending, or exactly one valid Human resume instruction or authority change or Human decision request is recorded.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-product-frontier` | Human resume instruction or authority change validates | `normal` | `pause-to-update` |
| `human-decision` | The user indicates a wish to resume but one required scope, permission, or risk choice remains missing | `interrupt` | `pause-to-human` |
| `recover-interrupted` | A response exists but Saved checkpoint or the required resume or decision record is missing, partial, or corrupt | `normal` | `pause-to-recover` |

### Product complete

**ID:** `product-complete`
**Kind:** `terminal`
**Summary:** Preserve the challenged, accepted product outcome and stop construction work.

#### Reads

- Final accepted record

#### Instruction

Expose the already persisted and verified accepted record. Perform no new write, deployment, activation, mailbox access, website action, or application submission in this terminal state.

#### Writes

- No new durable writes

#### Completion

The accepted outcome and its remaining assumptions were durably recorded and verified before entry; this terminal state does not itself activate the job agent or perform any application.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
