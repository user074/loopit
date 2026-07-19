# Running Loopit locally

This runbook covers the construction-studio MVP. `npm run dev` starts two local processes together:

- The web interface at `http://localhost:3000`.
- The local-agent daemon at `http://127.0.0.1:4318`.

Both processes run on the local machine. Loopit does not require a separate hosted account or API key; Codex and Claude use their existing CLI authentication.

## Start Loopit

From the Loopit repository:

```bash
node --version
codex --version
npm install
npm run dev
```

Node.js must be version 22.13 or newer. `npm install` is needed the first time and whenever `package.json` or `package-lock.json` changes.

Keep that terminal open. When startup succeeds, it prints both the Loopit daemon address and the Next.js web address. Open [http://localhost:3000](http://localhost:3000) in a browser.

To verify both parts without opening the UI:

```bash
curl --fail http://127.0.0.1:4318/api/health
curl --head --fail http://127.0.0.1:3000
```

The health response lists the local agent CLIs Loopit can find. If Codex is installed but reports a login problem, run `codex login status` and follow the CLI's login instructions.

## Stop the current agent turn

Use **Stop agent** in the construction chat to interrupt only the active Codex or Claude turn. The Loopit web interface and daemon remain running, and the saved loop proposal is preserved.

## Stop Loopit

Return to the terminal running `npm run dev` and press:

```text
Control-C
```

The development wrapper sends a termination signal to both the web interface and the local-agent daemon. Closing the browser tab does not stop either process.

Stopping Loopit preserves these files when they have been created:

- `.loopit/loop.md`, the versionable, agent-readable loop proposal.
- `.loopit/session.json`, the resumable local-agent session identifiers.

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

For debugging, use two terminals:

```bash
# Terminal 1
npm run dev:daemon

# Terminal 2
npm run dev:web
```

Press Control-C in each terminal to stop them. Normally, prefer `npm run dev` so startup and shutdown remain coordinated.

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
LOOPIT_CODEX_MODEL=gpt-5.5 npm run dev
```

### The UI opens but cannot reach the local bridge

Check `http://127.0.0.1:4318/api/health` and look at the terminal that launched Loopit. The daemon intentionally listens only on localhost, and the browser UI expects it on port 4318.

### `npm start` opens the UI but agent chat does not work

`npm start` starts only the production web server. For the local construction MVP, use `npm run dev`, which starts the web interface and agent daemon together.
