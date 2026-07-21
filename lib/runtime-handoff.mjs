const RUNTIME_OUTCOMES = new Set(["continue", "pause", "complete"]);

function singleLine(value, fallback = "") {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function reportField(section, label) {
  const match = section.match(
    new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${label}\\s*:\\s*(.+)`, "i"),
  );
  return singleLine(match?.[1]);
}

export function parseRuntimeHandoff(report) {
  const text = String(report ?? "").trim();
  const section =
    text.match(
      /(?:^|\n)##\s+Loopit iteration\s*\n([\s\S]*?)(?=\n##\s|$)/i,
    )?.[1] ?? text;
  const declaredOutcome = reportField(section, "Outcome").toLowerCase();
  const outcome = RUNTIME_OUTCOMES.has(declaredOutcome)
    ? declaredOutcome
    : "continue";

  return {
    outcome,
    state: reportField(section, "State").replace(/^`|`$/g, "") || "Next ready state",
    completed:
      reportField(section, "Completed") ||
      "Completed one durable loop iteration; inspect the worker report for details.",
    next:
      reportField(section, "Next") ||
      (outcome === "continue"
        ? "Continue from the latest durable project state and frontier."
        : outcome === "complete"
          ? "The declared completion policy accepted the outcome."
          : "Resolve the recorded boundary, then resume the saved next state."),
    reason:
      reportField(section, "Reason") ||
      (declaredOutcome
        ? "The worker reached the declared runtime outcome."
        : "No runtime boundary was declared, so the scheduler continues from durable artifacts."),
    declared: RUNTIME_OUTCOMES.has(declaredOutcome),
  };
}

export function serializeRuntimeIterations(iterations = []) {
  if (!iterations.length) return "_No loop iterations completed yet._";
  return iterations
    .map(
      (iteration) => `### Iteration ${iteration.number}

- Outcome: ${singleLine(iteration.outcome, "continue")}
- State: ${singleLine(iteration.state, "Next ready state")}
- Completed: ${singleLine(iteration.completed, "Completed one loop iteration")}
- Next: ${singleLine(iteration.next, "Continue from durable project state")}
- Reason: ${singleLine(iteration.reason, "No runtime boundary was declared")}
- Started: ${singleLine(iteration.startedAt)}
- Finished: ${singleLine(iteration.finishedAt)}`,
    )
    .join("\n\n");
}

function listField(block, label) {
  const match = block.match(new RegExp(`^- ${label}:\\s*(.*)$`, "im"));
  return singleLine(match?.[1]);
}

export function parseRuntimeIterations(markdown) {
  const section =
    String(markdown ?? "").match(
      /\n## Completed iterations\s*\n\n([\s\S]*?)(?=\n## Activity\s*\n)/,
    )?.[1] ?? "";
  if (!section || /^_No loop iterations/m.test(section)) return [];

  return section
    .split(/\n(?=### Iteration \d+\s*$)/m)
    .map((block) => {
      const number = Number(block.match(/^### Iteration (\d+)\s*$/m)?.[1]);
      if (!number) return null;
      const outcome = listField(block, "Outcome").toLowerCase();
      return {
        number,
        outcome: RUNTIME_OUTCOMES.has(outcome) ? outcome : "continue",
        state: listField(block, "State"),
        completed: listField(block, "Completed"),
        next: listField(block, "Next"),
        reason: listField(block, "Reason"),
        startedAt: listField(block, "Started") || null,
        finishedAt: listField(block, "Finished") || null,
      };
    })
    .filter(Boolean);
}
