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
  assert.match(html, /No loop yet|Recurring project loop/);
  assert.match(html, /Construct my first loop|Trace handoffs/);
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
  assert.match(studio, /Recurring project loop/);
  assert.match(studio, /StartingPackagePanel/);
  assert.match(studio, /Before the loop starts/);
  assert.match(studio, /First work enters step 1/);
  assert.match(studio, /StartingPackageEditor/);
  assert.match(studio, /Ask agent to propose it/);
  assert.match(studio, /Result package/);
  assert.match(studio, /Runtime safeguards/);
  assert.match(studio, /No named artifact handoff/);
  assert.match(studio, /Project stages only/);
  assert.match(studio, /Stage summaries and named handoffs/);
  assert.match(studio, /Full instructions, evidence, and exit rules/);
  assert.match(studio, /flow-loop-return-arrow/);
  assert.match(studio, /Back to step/);
  assert.match(
    studio,
    /zoom > 0[\s\S]*handoffSummary\(handoff\)[\s\S]*zoom === 2[\s\S]*handoffRole\(state\)/,
  );
  assert.match(
    studio,
    /zoom > 0[\s\S]*item\.description[\s\S]*zoom === 2[\s\S]*item\.initialContents/,
  );
});
