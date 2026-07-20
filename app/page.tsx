import { readFile } from "node:fs/promises";
import path from "node:path";
import { LoopStudio } from "./components/LoopStudio";
import type { LoopDefinition } from "@/lib/loop-types";
import { parseLoopMarkdown } from "@/lib/loop-markdown.mjs";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialLoop: LoopDefinition | null = null;
  let initialError: string | null = null;
  const projectRoot = path.resolve(
    process.env.LOOPIT_PROJECT || process.cwd(),
  );
  try {
    const source = await readFile(
      path.join(
        /* turbopackIgnore: true */ projectRoot,
        ".loopit",
        "loop.md",
      ),
      "utf8",
    );
    initialLoop = parseLoopMarkdown(source) as LoopDefinition;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      initialError =
        error instanceof Error ? error.message : "The loop could not be read.";
    }
  }
  return <LoopStudio initialError={initialError} initialLoop={initialLoop} />;
}
