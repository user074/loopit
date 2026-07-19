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
  assert.match(html, /Construction studio/);
  assert.match(html, /Construct the loop with an agent/);
  assert.match(html, /Proposed loop/);
  assert.match(html, /Loop validation/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("the product no longer depends on the disposable starter", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /LoopStudio/);
  assert.match(page, /\.loopit["',)]*,?[\s\S]*loop\.md/);
  assert.match(layout, /Loopit — Construct agent loops/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
});
