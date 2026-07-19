import { readFile } from "node:fs/promises";
import path from "node:path";
import { LoopStudio } from "./components/LoopStudio";
import type { LoopDefinition } from "@/lib/loop-types";
import { parseLoopMarkdown } from "@/lib/loop-markdown.mjs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const source = await readFile(
    path.join(process.cwd(), ".loopit", "loop.md"),
    "utf8",
  );
  const initialLoop = parseLoopMarkdown(source) as LoopDefinition;
  return <LoopStudio initialLoop={initialLoop} />;
}
