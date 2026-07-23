import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const port = 4400 + (process.pid % 200);
const origin = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn(process.execPath, [nextCli, "start", "-p", String(port)], {
    cwd: root,
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("The Next.js production server did not start in time.");
});

after(() => {
  server?.kill("SIGTERM");
});

async function render() {
  return fetch(origin, { headers: { accept: "text/html" } });
}

test("server-renders the Loopit construction studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Loopit — Construct agent loops<\/title>/i);
  assert.match(html, /Construct a continuing loop/);
  assert.match(html, /New conversation/);
  assert.match(html, /\+ New/);
  assert.match(html, /History/);
  assert.match(html, /No loop yet|How the work continues/);
  assert.match(html, /Construct my first loop|Start test|Retry test|Review decision|Test again/);
  assert.match(html, /Start the loop/);
  assert.match(html, /Start loop/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("the product no longer depends on the disposable starter", async () => {
  const [page, layout, packageJson, studio, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LoopStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /LoopStudio/);
  assert.match(page, /\.loopit["',)]*,?[\s\S]*loop\.md/);
  assert.match(layout, /Loopit — Construct agent loops/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.match(studio, /FLOW_ZOOM_LABEL/);
  assert.match(studio, /FLOW_ZOOM_DESCRIPTION/);
  assert.match(studio, /How the work continues/);
  assert.match(studio, /Edit selected step/);
  assert.match(studio, /\+ Add step/);
  assert.match(studio, /flow-node-edit/);
  assert.match(studio, /StartingWorkPanel/);
  assert.match(studio, /What matters first/);
  assert.match(studio, /Starting work/);
  assert.match(studio, /Begin the cycle/);
  assert.match(studio, /StartingPackageEditor/);
  assert.match(studio, /StartingWorkTable/);
  assert.match(studio, /work-item-table/);
  assert.match(studio, /first-task-spotlight/);
  assert.match(studio, /SetupPanel/);
  assert.match(studio, /Specified separately/);
  assert.match(studio, /setup-disclosure/);
  assert.match(studio, /setup-table/);
  assert.match(studio, /Ask agent to propose it/);
  assert.match(studio, /What is already known/);
  assert.match(studio, /What remains to pursue/);
  assert.match(studio, /What is ready to use/);
  assert.match(studio, /What to do first/);
  assert.match(studio, /Pauses and stopping rules/);
  assert.match(studio, /No named artifact handoff/);
  assert.match(studio, /The work cycle in project language/);
  assert.match(studio, /What each step produces for the next/);
  assert.match(studio, /Instructions, evidence, and exit rules/);
  assert.match(studio, /flow-loop-return-arrow/);
  assert.match(studio, /Back to step/);
  assert.match(studio, /runUnifiedTest/);
  assert.match(studio, /One click checks, repairs, and retests/);
  assert.match(studio, /Required before runtime/);
  assert.match(studio, /What was checked or changed/);
  assert.match(studio, /Path to a passed loop test/);
  assert.match(studio, /Trace every path/);
  assert.match(studio, /Test with a fresh agent/);
  assert.match(studio, /Fix or ask you/);
  assert.match(studio, /Loop test passed/);
  assert.match(studio, /Retry test/);
  assert.match(studio, /runtime-launch/);
  assert.match(studio, /Runtime control plane/);
  assert.match(studio, /Project command map/);
  assert.match(studio, /RuntimeOperationsMap/);
  assert.match(studio, /runtime-map-board/);
  assert.match(studio, /runtime-region-progress/);
  assert.match(studio, /Current mission/);
  assert.match(studio, /Live here/);
  assert.match(studio, /runtime-region-worker-badge/);
  assert.match(studio, /runtimeWorkVisual/);
  assert.match(studio, /runtime-work-scene/);
  assert.match(studio, /runtime-region-live-action/);
  assert.match(studio, /Planning the next move/);
  assert.match(studio, /Reading project files/);
  assert.match(studio, /Editing project files/);
  assert.match(studio, /Running tests/);
  assert.match(studio, /Reviewing and integrating the result/);
  assert.match(
    styles,
    /\.runtime-observer-scroll\s*\{[\s\S]*overflow-x:\s*hidden/,
  );
  assert.match(
    styles,
    /\.runtime-observer-panel \.activity-output pre\s*\{[\s\S]*width:\s*100%/,
  );
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.runtime-observer-scroll-wrap/);
  assert.match(styles, /scrollbar-gutter:\s*stable/);
  assert.match(styles, /-webkit-line-clamp:\s*unset/);
  assert.match(studio, /activity-entry-title/);
  assert.match(studio, /activity-entry-detail/);
  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*clamp\(360px,\s*34vw,\s*480px\)/,
  );
  assert.match(
    styles,
    /\.runtime-observer-panel \.activity-entry-title[\s\S]*overflow-wrap:\s*anywhere/,
  );
  assert.match(
    styles,
    /\.runtime-observer-panel \.activity-entry header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/,
  );
  assert.match(studio, /runtime-semantic-zoom/);
  assert.match(studio, /Past result, current work, and next item/);
  assert.match(studio, /runtime-area-dock/);
  assert.match(studio, /Close area details/);
  assert.match(studio, /region\.progressLabel/);
  assert.match(studio, /Not reviewed by you/);
  assert.match(studio, /Mark all reviewed/);
  assert.match(studio, /Worker loop position/);
  assert.match(studio, /Ask about this/);
  assert.match(studio, /Issue direction/);
  assert.match(studio, /runtime-observer-panel/);
  assert.match(studio, /Live worker and controls/);
  assert.match(studio, /What the worker is doing/);
  assert.match(studio, /Ask and intervene/);
  assert.match(studio, /Is the worker stuck or blocked/);
  assert.match(studio, /Stop now/);
  assert.match(studio, /followLive/);
  assert.match(studio, /distanceFromBottom/);
  assert.match(studio, /Jump to live/);
  assert.match(studio, /Understanding agent activity/);
  assert.match(studio, /event\.type === "activity"/);
  assert.match(studio, /Queue direction/);
  assert.match(studio, /buildRuntimeMap/);
  assert.match(studio, /What exists/);
  assert.match(studio, /What we believe/);
  assert.match(studio, /Known failures/);
  assert.match(studio, /Durable trajectory/);
  assert.match(studio, /Guided/);
  assert.match(studio, /Unattended/);
  assert.match(studio, /\/api\/runtime\/understand/);
  assert.match(studio, /\/api\/runtime\/steer/);
  assert.match(studio, /\/api\/runtime\/autonomy/);
  assert.match(studio, /\/api\/runtime\/review/);
  assert.match(studio, /Continuous runtime/);
  assert.match(studio, /Loop progress/);
  assert.match(studio, /Run \{iteration\.runNumber\} · iteration/);
  assert.match(studio, /runtimeIterations/);
  assert.match(studio, /runtimeProgressIterations/);
  assert.match(studio, /completed across/);
  assert.match(studio, /will start the next worker automatically/);
  assert.match(studio, /Live agent activity/);
  assert.match(studio, /Live worker transcript/);
  assert.match(studio, /Worker operational transcript/);
  assert.match(studio, /View final worker report/);
  assert.match(studio, /View all \$\{entries\.length\} events/);
  assert.match(studio, /event\.type === "heartbeat"/);
  assert.match(studio, /Construction agent activity/);
  assert.match(studio, /Loop test activity/);
  assert.match(studio, /activity-feed/);
  assert.match(studio, /formatRuntimeDuration/);
  assert.match(studio, /window\.setInterval\(\(\) => setRuntimeClock\(Date\.now\(\)\), 1000\)/);
  assert.match(studio, /Last continuous run/);
  assert.match(studio, /Pass Test this loop for revision/);
  assert.match(studio, /fetch\(`\$\{DAEMON_URL\}\/api\/run`/);
  assert.match(studio, /Start loop/);
  assert.match(studio, /Inspect this repository and propose its loop/);
  assert.match(studio, /Understanding this repository/);
  assert.match(studio, /MAX_AUTOMATIC_REPAIRS = 3/);
  assert.match(studio, /Automatic repair.*created revision/);
  assert.match(studio, /seenLoopSignatures/);
  assert.match(studio, /stopped safely after.*automatic repairs/);
  assert.match(studio, /extractHumanReview/);
  assert.match(studio, /human-review-overlay/);
  assert.match(studio, /Your decision is needed/);
  assert.match(studio, /Recommended next step/);
  assert.match(studio, /submitHumanReview/);
  assert.match(studio, /Send decision/);
  assert.match(studio, /await runUnifiedTest\(revisedLoop\)/);
  assert.doesNotMatch(studio, />Trace handoffs</);
  assert.doesNotMatch(studio, />Test with /);
  assert.match(
    studio,
    /<StartingWorkPanel[\s\S]*<StateFlowCanvas[\s\S]*<SetupPanel/,
  );
  assert.match(
    studio,
    /className="validation-details"[\s\S]*loop-test-section[\s\S]*runtime-launch/,
  );
  assert.match(
    studio,
    /zoom > 0[\s\S]*handoffSummary\(handoff\)[\s\S]*zoom === 2[\s\S]*usualTransition\.when/,
  );
  assert.doesNotMatch(studio, /handoffRole/);
  assert.doesNotMatch(
    studio,
    /<small>\{STATE_KIND_LABEL\[state\.kind\]\}<\/small>/,
  );
  assert.match(
    studio,
    /compactContent\(content, index\)[\s\S]*defaultOpen|compactContent\(content, index\)[\s\S]*open=\{zoom/,
  );
});
