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
  assert.match(html, /Construct my first loop|Start test|Continue test|Review decision|Test again/);
  assert.match(html, /Start the loop/);
  assert.match(html, /Start loop/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("the product no longer depends on the disposable starter", async () => {
  const [page, layout, packageJson, studio] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LoopStudio.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /LoopStudio/);
  assert.match(page, /\.loopit["',)]*,?[\s\S]*loop\.md/);
  assert.match(layout, /Loopit — Construct agent loops/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.match(studio, /FLOW_ZOOM_LABEL/);
  assert.match(studio, /FLOW_ZOOM_DESCRIPTION/);
  assert.match(studio, /How the work continues/);
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
  assert.match(studio, /One path to a final result/);
  assert.match(studio, /Required before runtime/);
  assert.match(studio, /What was checked or changed/);
  assert.match(studio, /Path to a passed loop test/);
  assert.match(studio, /Trace every path/);
  assert.match(studio, /Test with a fresh agent/);
  assert.match(studio, /Fix or ask you/);
  assert.match(studio, /Loop test passed/);
  assert.match(studio, /Continue test/);
  assert.match(studio, /runtime-launch/);
  assert.match(studio, /Continuous runtime/);
  assert.match(studio, /formatRuntimeDuration/);
  assert.match(studio, /window\.setInterval\(\(\) => setRuntimeClock\(Date\.now\(\)\), 1000\)/);
  assert.match(studio, /Last continuous run/);
  assert.match(studio, /Pass Test this loop for revision/);
  assert.match(studio, /fetch\(`\$\{DAEMON_URL\}\/api\/run`/);
  assert.match(studio, /Start loop/);
  assert.match(studio, /Automatic repair created revision/);
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
