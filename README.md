# Loopit

**Construct, run, and steer long-running agent loops.**

Loopit is a control plane for continuing agent work. It helps a person turn an objective into a durable, testable loop that can keep making meaningful progress for 24 hours or longer, then makes that loop understandable, steerable, and easy to improve.

> **Project status:** first local construction-studio MVP.

## Try the construction MVP

This version focuses only on the first product problem: working with an agent to construct and rehearse a loop that can actually continue. It does not execute or monitor long-running production work yet.

The screen has two connected parts:

- **Construction chat** launches the Codex or Claude Code CLI already installed and authenticated on the local machine. A new project begins empty: the agent first asks what work the user wants to keep progressing, then proposes the smallest useful loop. Conversations survive reloads as local Markdown files in `.loopit/conversations/`. **New** starts with an empty agent session, while **History** reopens a past conversation together with its own resumable CLI context.
- **Visual loop editor** first shows the agent-proposed starting point, then the recurring domain loop and the deliverable passed at each handoff. The UI uses the work function's own vocabulary; “Starting Package,” “state,” and “frontier” remain internal contract terms. Semantic zoom moves from familiar names, to purposes and handoffs, to full contents and rules. Pauses and stopping rules stay in a separate collapsed view. The user can edit the objective, starting point, completion policy, state contracts, and transitions directly; every visual save rewrites `.loopit/loop.md`, which the agent reads on its next turn.
- **Preflight testing** can trace every transition in seconds, visibly prove that the recurrence closes, and then launch a fresh read-only local agent to challenge state contracts and edge cases. The rehearsal cannot modify or execute the project; its latest Markdown report is saved at `.loopit/test-report.md`. A non-passing result automatically becomes the next construction turn: the agent repairs agent-owned gaps and asks one focused question for missing human intent or authority.

Requirements: Node.js 22.13 or newer and at least one locally authenticated agent CLI (`codex` or `claude`). No separate API key or hosted Loopit account is used.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The web process and localhost-only agent daemon start together. Choose **Construct my first loop** or describe the work directly in chat. Construction-agent session pointers are remembered in `.loopit/session.json`, readable conversation histories in `.loopit/conversations/*.md`, and the loop proposal in the versionable `.loopit/loop.md`.

Markdown is the durable agent-facing source of truth, not the primary human interface. Loopit parses it into an internal graph for deterministic checks and presents the understandable, interactive version in the web UI. JSON is used only for machine-owned active-conversation and CLI-session identifiers; no generated JSON copy of a loop, conversation, or test report is committed or maintained.

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

A loop is a durable feedback system that repeatedly turns an unresolved frontier item into a portable result, integrates that result into shared state, and selects what should happen next.

The following is Loopit's **construction invariant**, not a workflow template and not the language shown to the user:

```text
State + frontier
      ↓ select and define
Work contract
      ↓ execute
Result package
      ↓ interpret and integrate
Updated state + frontier
      ↺
```

The construction agent uses this invariant to check continuity, then translates it into the project's own work cycle. A research user should see hypotheses, experiments, evidence, and belief updates. A product builder should see capability gaps, feature slices, working builds, and product decisions. If the right panel still says only “work contract” and “result package” after the domain is understood, construction is not finished.

### Choose the subject of the loop first

The product being described is not always the work the loop should perform. “Build an agent that continuously searches and applies for jobs” contains two possible loops:

- A **development loop** that repeatedly selects a missing capability, designs a slice, implements and tests it, and updates product state.
- An **operating loop** in which an already-built agent repeatedly searches, applies, reconciles responses, and updates its search frontier.

Creation language such as **build**, **create**, **develop**, or **make an app/agent** defaults to the development loop. The described future behavior becomes the capability frontier and acceptance scenarios; it does not become the recurring state flow. An operating loop should be proposed only when the user says the system already exists or explicitly asks to run or operate it. If both are genuinely plausible, the agent asks which subject to construct before writing the loop. If both are wanted, they remain separate loops and development comes first unless the user chooses otherwise.

A prompt requests an action. A plan anticipates steps. A workflow follows predefined transitions. A loop observes what happened, judges what it means, updates its model of the work, and derives what should happen next.

## The minimal loop contract

Every domain loop needs:

- **Objective** — the outcome the loop is trying to advance.
- **Starting Package** — the smallest domain-specific state, frontier, working foundation, and first executable item needed to begin the first real iteration.
- **Durable state** — a compressed, inspectable representation of what is currently true.
- **Frontier** — gaps, uncertainties, failures, missing evidence, or opportunities that justify more work.
- **Work contract** — one bounded unit of work, its inputs, intended deliverable, and acceptance evidence.
- **Result package** — the portable handoff containing the deliverable, evidence, outcome, provenance, and unresolved findings.
- **Integration policy** — how a result changes durable state, resolves or creates frontier items, and selects another contract.

The frontier is not merely a queue. It is a derived view of the distance between current evidence and the objective. Consuming its present items without regenerating that comparison produces a finite workflow, not a continuing loop.

The loop engine can remain consistent across domains, but the loop structure does not have to. Its visible stages should match the natural transformations and handoffs of the work. Split a stage only when it produces a meaningful deliverable for a different consumer or kind of judgment; combine stages when separating them would add ceremony without a useful handoff.

| Work | Concrete recurring loop | Portable handoff |
|---|---|---|
| Research | Hypothesis frontier → experiment plan → run and collect data → analyze and validate or invalidate → update beliefs and add hypotheses ↺ | Experiment report with data, plots, verdict, confounds, and new hypotheses |
| Independent app development | Feature backlog → plan feature → implement → test → review → update product status and backlog ↺ | Working code with test results, known limitations, and follow-up bugs |
| Software engineering | Issue and acceptance frontier → change plan → implementation → CI and review → integrate verified system state and backlog ↺ | Change result with commit or pull request, diff, tests, review evidence, environment, and known issues |
| UI/UX design | User need or design question → exploration brief → prototype or design version → usability evaluation → design decision and next question ↺ | Design evaluation packet with prototype, rationale, comparisons, findings, and open questions |
| Business | Opportunity or decision frontier → analysis or action brief → proposal, campaign, or operating decision → measure outcome → update business model and priorities ↺ | Decision or outcome packet with sources, assumptions, metrics, risks, and recommended follow-up |

These are examples, not preset templates. The construction agent should inspect the actual project and propose the smallest concrete loop that fits it. The user then corrects its phases, handoffs, and priorities before verification.

### Bootstrap the loop with a Starting Package

A valid recurring cycle can still fail to start when its initial state and work are empty. Before the first iteration, the construction agent therefore proposes a **Starting Package** translated into the work function's own language. It always fills four semantic roles:

1. **Evidence-backed state** — what is currently known, observed, decided, or already exists; proposals remain explicitly unproven.
2. **Initial frontier** — objective-grounded gaps, questions, opportunities, cases, or uncertainties that can justify work.
3. **Working foundation** — the minimum tools, materials, data, access, authority, templates, environment, or conventions required to produce and inspect a real result.
4. **First work item** — one bounded item selected from the frontier that is executable with the proposed foundation and produces evidence for the next transition.

Those four roles are the general contract, not the visible vocabulary. Research might begin with current beliefs, hypotheses, experimental equipment and data access, and a first experiment. Design might begin with user research, design questions, a design system and prototype tools, and a first exploration. Business operations might begin with the current operating picture, an opportunity or case list, authorized tools and playbooks, and a first action. Software might begin with current product status, a feature backlog, a development and test environment, and a first feature—but Loopit must not assume code, cloud infrastructure, or a technology stack when the work does not require them.

The agent should infer and propose this package from the objective, existing workspace, and work function. It should choose the smallest reversible foundation that lets the work produce trustworthy results. A nonexpert should be asked about intent, cost, authority, risk, or material constraints only when those choices genuinely belong to the human; they should not be asked to invent raw methodology or infrastructure from scratch.

The Markdown roles are engine metadata. Human-facing names must use established vocabulary from the profession, preferably reused from the project's existing documents and tools. A researcher sees current beliefs, hypotheses, method, experiment, data, and analysis. A developer sees product status, feature backlog, feature plan, implementation, tests, code review, and merge. A designer sees research findings, a design brief, wireframes or prototypes, critique or usability testing, and a design decision. “Domain-specific” is not permission to coin impressive-sounding compound nouns: if a practitioner would need a Loopit glossary to understand “capability evidence map,” “frame capability slice,” or “product review disposition,” translation has failed.

### Frontier replenishment is what makes the loop continue

A back arrow only proves that control can return. It does not prove that useful next work exists. Every loop therefore needs a domain-specific frontier replenishment contract.

Each new frontier item must cite:

- The objective criterion, requirement, question, or declared outcome it advances.
- The result, observation, failed check, missing evidence, or explicit human scope change that caused it to exist.
- Why it is not already resolved or duplicated.
- What evidence would allow the loop to retire it.

When integration empties the current frontier, the loop compares durable state and evidence with the objective. That comparison must produce exactly one justified outcome: new objective-backed frontier work, a scheduled observation when external change is expected, one human-owned decision, or a completion candidate. Empty work is never an unexplained stop, but continuity is not permission to invent unrelated or low-value work.

### The result package is the unit of handoff

The result is more important than the agent or session that produced it. A useful result can move between a worker and supervisor, between specialized agents, across context resets, or between human teams without relying on a hidden conversation.

A result package is a thin envelope around the domain's natural deliverable. “Result package” is the engine's generic type; the actual artifact should use the domain's language, such as **Experiment report**, **Feature result**, **Change result**, or **Design evaluation packet**. It normally identifies:

- The work contract and prior-state version it answers.
- The native deliverable or stable reference to it.
- Observable evidence and checks.
- Outcome: completed, partial, failed, or blocked. Negative results remain valid results.
- What changed, what remains unresolved, and candidate follow-up work.
- Provenance needed for another agent or human to inspect and continue.

Loopit should first search the existing project and work history for native handoffs—reports, commits, pull requests, tickets, design versions, spreadsheets, CRM records, decision memos, or other established deliverables. It should add documentation only when the native artifact lacks context required by its next consumer.

### Domain loop and runtime policy are separate

The visible loop describes how domain results advance work. Setup, retries, interrupted-session recovery, permissions, budgets, human decisions, and completion acceptance are runtime policies around that loop. They should not become repeated states or branches unless they are themselves meaningful domain work.

- **Setup** prepares the initial durable state before the loop begins.
- **Recovery** resumes the current operation from durable artifacts; it does not own a domain handoff.
- **Human interruption** fires only when policy requires judgment and no authorized work can continue.
- **Completion challenge** is an optional acceptance protocol invoked for a candidate outcome, not an ordinary step in every iteration.

## Stage 1: construct and prove a loop

The first product problem is not monitoring. It is helping a user create a loop that truly continues.

### Agent-led construction

The user should not need to place nodes or write a loop specification manually. In chat, the construction agent should:

1. Separate the thing being built or operated from the work the loop itself should repeatedly advance.
2. Classify the loop subject as development, operation, research, design, or another concrete mode, and present that interpretation for correction.
3. Inspect the existing project, tools, documents, and environment.
4. Clarify the objective, success conditions, constraints, and available resources.
5. Propose the domain-specific Starting Package: evidence-backed state, objective-grounded frontier, minimum working foundation, and first executable work item.
6. Infer the chosen work mode's natural recurring cycle rather than imposing generic phases.
7. Identify its existing deliverables, the producer and consumer of each handoff, and the judgment each handoff enables.
8. Give every visible phase, Starting Package component, and artifact a concrete project-specific name.
9. Define the smallest domain-named result package that makes the primary deliverable inspectable and portable across agents and sessions.
10. Identify how each integrated result changes durable state and the frontier.
11. Define how the objective and new evidence replenish the frontier, including the empty-frontier protocol and the rule that prevents unrelated busywork.
12. Propose the smallest coherent concrete loop for the user to correct; do not ask the user to design it from scratch.
13. Define runtime policies for autonomy, interruption, budget, recovery, and completion separately from the domain loop.
14. Generate the edited loop, ask the user to confirm the important choices, and run a fresh-session rehearsal.

### Prove continuity

A circular diagram does not prove that a loop works. Loopit should execute controlled iterations and verify that:

- The Starting Package contains a real, domain-named component for all four roles and does not present proposed assumptions as observed truth.
- Its first work item is drawn from the frontier, executable with the working foundation, and capable of producing evidence.
- Current state can produce a justified action.
- The work contract produces a valid, portable result package.
- A fresh consumer can inspect the deliverable and evidence without hidden chat context.
- The result is interpreted and integrated into durable state rather than merely recorded.
- A valid next action or explicit terminal state is produced.
- A fresh agent session can resume from the saved state.
- Failures lead to bounded recovery or escalation instead of silent termination.

The minimal continuity test below uses engine language. The rehearsal should trace the actual domain-named artifacts that occupy each role:

```text
state + frontier
  → work contract
  → result package
  → integrated state + frontier
  → next work contract
  → consume the result in a fresh session
```

The 24-hour goal is not simply keeping a process alive. The loop must make meaningful, evidence-backed transitions, recover from expected failures, survive session boundaries, and stop only for a declared reason.

### Loop invariants

Loopit should be able to validate a small set of universal rules:

1. No work contract without a frontier item.
2. No completed iteration without a result package.
3. No result package without an inspectable deliverable or explicit failed or blocked outcome.
4. No result is complete until its consumer can interpret it without hidden chat context.
5. No iteration ends before the result is integrated into durable state and the frontier.
6. No continuation without a justified next work contract traceable to the objective and new evidence.
7. No stopping except at a runtime boundary.
8. Every saved result and state must be consumable by a fresh agent session.
9. An empty frontier must trigger objective comparison, not silent stopping or invented busywork.

The runtime, not an individual agent response, owns continuation. An agent finishing a turn does not mean the mission is complete.

### Completion is a runtime acceptance policy

Loopit separates three things that agents often collapse together:

1. **State complete** — this bounded action produced the evidence needed to leave its current state.
2. **Candidate complete** — the current evidence appears to satisfy the project objective.
3. **Accepted outcome** — the configured runtime policy has challenged or reviewed the candidate and permits acceptance.

A challenger can be invoked when integration produces a completion candidate, without becoming a permanent domain-loop state. It classifies each new thought before the runtime decides what happens next:

- An agent-owned blocking gap returns to the active frontier.
- Missing human intent, preference, fact, or authority becomes one focused question.
- A useful but nonblocking idea is preserved in a follow-up backlog instead of silently expanding the present objective.

Each loop declares one policy:

| Policy | Best fit | Acceptance rule |
|---|---|---|
| **Human confirms candidate** | Product and engineering by default | A fresh challenge passes, then the human accepts the scoped outcome or adds another blocking thought. |
| **Evidence can auto-accept** | Narrow work with objective checks | A fresh challenge finds no blocker and every declared evidence check passes. |
| **Continuous until interrupted** | Research and open-ended exploration | New findings replenish the frontier; a human, budget, or explicit boundary pauses the loop. |

Automation can generate the questions a thoughtful human would ask—recheck evidence, test edge cases, inspect unmet requirements, compare the result with the objective—but it should not invent taste, product intent, risk tolerance, or permission. Those remain human-owned inputs. This lets a product or engineering loop continue autonomously for long periods without mistaking its first plausible draft for the final answer.

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

The left side is how the user constructs and modifies the loop with an agent. The right side is not a generic workflow template and does not teach the user Loopit's ontology. Before the cycle, it shows a **Starting point** labeled with the profession's familiar terms; the user can correct it without designing the work method from scratch. Its default cycle view uses concrete phase and deliverable names. The generic State → Work contract → Result package → Integrated state model is only a hidden construction and validation guideline. Zooming in reveals the domain-named contents and handoffs, then plain-language operating rules. Pauses and stopping rules live in a separate collapsed view.

The right side should initially answer six questions:

1. Where is the loop now?
2. What state did this iteration begin with?
3. What result package was produced, and where is its deliverable?
4. Could another agent or human consume it without hidden context?
5. How did the result change state and the frontier?
6. Is there a valid next iteration, or which runtime boundary fired?

## Reference implementation

[`delta-research`](https://github.com/user074/delta-research) is the first working reference for these ideas. Its research loop maintains beliefs, a run ledger, an experiment frontier, plans, reports, and a human-facing synthesis. Each completed experiment updates the belief state and creates or reprioritizes the next research delta.

Its important lesson is that `REPORT.md` is the portable handoff between worker and supervisor. The report packages the experiment's deliverable, data, verdict, confounds, and proposed follow-up work. The iteration ends only after the supervisor consumes that package, compresses durable state, and selects another contract or a valid interrupt.

For software engineering, the native deliverable may be a commit, pull request, working feature, migration, or testable build. The result package adds the contract it answers, diff or artifact reference, tests and runtime evidence, known limitations, and follow-up candidates. The next agent should be able to review, branch, test, integrate, or revise it without reconstructing the previous session.

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
