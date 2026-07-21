# Running Loopit locally

This runbook covers the construction gate and minimal continuous local runtime. Loopit separates two repositories:

- The **Loopit repository** contains only the control-plane application.
- The **target project** contains the work, its `.loopit` definition and history, and every file a runtime worker may modify.

The `loopit` launcher starts two local processes together:

- The web interface at `http://localhost:3000`.
- The local-agent daemon at `http://127.0.0.1:4318`.

Both processes run on the local machine. Loopit does not require a separate hosted account or API key; Codex and Claude use their existing CLI authentication.

## Start Loopit

Install or update the control plane once from the Loopit repository:

```bash
node --version
codex --version
npm install
npm link
```

Node.js must be version 22.13 or newer. `npm install` is needed the first time and whenever `package.json` or `package-lock.json` changes. `npm link` makes the local `loopit` launcher available without copying Loopit's source into another project.

Now change to the repository where the agent should do actual work and launch Loopit there:

```bash
cd /path/to/your-project
loopit
```

Keep that terminal open. Startup prints both the immutable control-plane path and the target-project path, followed by the Loopit daemon and Next.js addresses. Open [http://localhost:3000](http://localhost:3000) in a browser and confirm that **Target project** in the header names the intended repository before constructing or running anything.

If you do not want to use `npm link`, launch from the Loopit repository with an explicit absolute target path:

```bash
npm run dev -- /absolute/path/to/your-project
```

Running `npm run dev` without a target is control-plane development mode. The UI can open, but runtime is protected because the Loopit source repository is not a valid runtime target.

To verify both parts without opening the UI:

```bash
curl --fail http://127.0.0.1:4318/api/health
curl --head --fail http://127.0.0.1:3000
```

The health response lists `appRoot`, `projectRoot`, whether runtime is allowed, and the local agent CLIs Loopit can find. Verify that `projectRoot` is the intended external repository and differs from `appRoot`. If Codex is installed but reports a login problem, run `codex login status` and follow the CLI's login instructions.

## Stop the current agent turn

Use **Stop agent** in the construction chat to interrupt only the active Codex or Claude turn. The Loopit web interface and daemon remain running, and the saved loop proposal is preserved.

When a loop worker is active, use **Stop loop** in the Runtime section instead. This interrupts the worker without stopping Loopit and preserves the project artifacts and readable run record created so far.

## Stop Loopit

Return to the terminal running `loopit` (or `npm run dev -- /path/to/target`) and press:

```text
Control-C
```

The development wrapper sends a termination signal to both the web interface and the local-agent daemon. Closing the browser tab does not stop either process.

Stopping Loopit preserves these files in the target project when they have been created:

- `.loopit/loop.md`, the versionable, agent-readable loop proposal.
- `.loopit/session.json`, the active-conversation pointer and resumable local-agent session identifiers.
- `.loopit/conversations/*.md`, the readable local conversation histories shown after a page reload or selected from **History**.
- `.loopit/test-report.md`, the latest fresh-agent rehearsal report.
- `.loopit/runs/*.md`, readable continuous-run records with each completed iteration, completed work, next state, next work, activity, and latest worker report.

Use **New** in the conversation header to start an empty conversation with a fresh Codex or Claude session. The current conversation moves into **History** rather than being destroyed. Selecting a past conversation restores both its visible messages and its own local-agent session. Conversation switching does not delete or replace `.loopit/loop.md`; all conversations in the project discuss the same current loop definition.

## Test a loop before running it

The separate **Test this loop** section follows structural checks and presents one bounded path to Passed:

1. **Trace every path** animates one ordinary recurrence and every alternate transition. It fails when the cycle does not close, a transition is missing, or a structural check blocks continuation. This test is deterministic and does not start an agent. When it fails, Loopit sends its exact findings directly to an automatic repair turn and skips the unnecessary fresh rehearsal.
2. Once the deterministic trace passes, a fresh Codex or Claude session with no construction-chat context challenges state inputs, completion conditions, recovery paths, interrupts, and completion exits, then saves a Markdown report. The rehearsal cannot modify files or execute the proposed production work.
3. A failed trace or agent rehearsal starts an automatic repair and then retests the resulting revision without another click. One test run allows up to three repairs. It stops sooner when the loop passes, needs a genuinely human-owned decision, makes no durable change, or repeats a previously tested design. The audit names every tested revision and repair round.

Parser and schema repair never belongs to the human. Construction-agent output is constrained before Loopit writes Markdown, including required IDs and the allowed Role, state Kind, boundary Kind, and transition Kind values. Human review opens only when the test report contains a structured question about human-owned intent, authority, private facts, cost, policy, or risk, together with the exact context and consequence.

Passed unlocks **Start loop** at the bottom of the right panel only when the target is separate from the Loopit repository. Start launches a local worker with the target project as its working directory; it does not reuse the construction conversation. Each worker completes one ordinary recurrence, integrates its evidence into durable project artifacts, and reports Completed, Next, State, and Continue/Pause/Complete in Markdown. A Continue handoff starts the next fresh worker automatically. A Pause handoff is valid only for a declared human decision, permission, budget, scheduled observation, or unrecoverable blocker; Complete requires the loop's configured acceptance policy. The Runtime section shows completed iterations plus a live feed of commands, reads, edits, tools, and planning events. The continuous clock spans the full chain and freezes when the runtime pauses, fails, completes, is interrupted, or the user presses **Stop loop**.

## If the original terminal is gone

First identify the exact processes listening on Loopit's two ports:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:4318 -sTCP:LISTEN
```

Check that the listed commands belong to Loopit, then run `kill` followed by only those numeric process IDs. For example, if `lsof` reports PIDs 12345 and 12346:

```bash
kill 12345 12346
```

Confirm that both ports are clear by running the two `lsof` commands again. Avoid broad commands such as `pkill node`, because they can stop unrelated local projects.

## Run the two parts separately

For debugging the control plane, use two terminals in the Loopit repository and provide the same target to both processes:

```bash
# Terminal 1
LOOPIT_PROJECT=/absolute/path/to/your-project npm run dev:daemon

# Terminal 2
LOOPIT_PROJECT=/absolute/path/to/your-project npm run dev:web
```

Press Control-C in each terminal to stop them. Normally, prefer `loopit` from the target repository so startup, project identity, and shutdown remain coordinated.

## Common startup problems

### Port 3000 or 4318 is already in use

Use the `lsof` commands above to inspect the listener. Stop it only if it is an older Loopit process; otherwise leave it alone and resolve the port conflict explicitly.

### Codex says its configured model requires a newer CLI

Update Codex and verify the installed version:

```bash
codex update
codex --version
```

Loopit also accepts a temporary per-run model override when diagnosing compatibility:

```bash
cd /path/to/your-project
LOOPIT_CODEX_MODEL=gpt-5.5 loopit
```

### The UI opens but cannot reach the local bridge

Check `http://127.0.0.1:4318/api/health` and look at the terminal that launched Loopit. The daemon intentionally listens only on localhost, and the browser UI expects it on port 4318.

### Runtime says to choose a separate target project

Loopit was launched with its own source repository as the target. Stop it, change to the repository the agent should modify, and run `loopit` there. Alternatively, restart from the Loopit repository with `npm run dev -- /absolute/path/to/your-project`.

### Codex says the target is not a trusted directory

Restart Loopit using the current launcher. Loopit explicitly selects the target project and allows Codex to work there even before `git init`, while retaining the role's read-only or workspace-write sandbox. If the message persists, confirm that an older daemon is not still listening on port 4318.

### `npm start` opens the UI but agent chat does not work

`npm start` starts only the production web server. Use `loopit` from the target repository, which starts the web interface and agent daemon together with a shared target-project identity.
