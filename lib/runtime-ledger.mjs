function line(value, fallback = "") {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function list(values) {
  const items = (values ?? []).map((value) => line(value)).filter(Boolean);
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "_None._";
}

function field(block, label) {
  return (
    block.match(new RegExp(`^- ${label}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? ""
  );
}

function section(block, heading) {
  return (
    block.match(
      new RegExp(
        `(?:^|\\n)### ${heading}\\s*\\n\\n([\\s\\S]*?)(?=\\n### |$)`,
      ),
    )?.[1] ?? ""
  );
}

function bullets(source) {
  return source
    .split(/\r?\n/)
    .filter((entry) => /^-\s+/.test(entry))
    .map((entry) => line(entry.replace(/^-\s+/, "")))
    .filter(Boolean);
}

export function serializeRuntimeLedger(entries = []) {
  const body = entries.length
    ? entries
        .map(
          (entry) => `## Iteration ${entry.number} — ${entry.title}

- ID: ${entry.id}
- Run: ${entry.runId}
- Loop revision: ${entry.loopRevision ?? ""}
- Assignment: ${entry.assignmentId}
- Outcome: ${entry.outcome}
- Progress: ${entry.progress}
- Started: ${entry.startedAt}
- Finished: ${entry.finishedAt}
- State: ${entry.fromVersion} → ${entry.toVersion}
- Report: ${entry.reportPath}
- Completed: ${entry.completed}
- Next: ${entry.next}
- Reason: ${entry.reason}

### State changes

${list(entry.stateChanges)}

### Frontier changes

${list(entry.frontierChanges)}

### Requirement relaxations

${list(entry.relaxations)}`,
        )
        .join("\n\n")
    : "_No runtime iterations recorded._";
  return `---
loopit-runtime-ledger: 1
entries: ${entries.length}
---

# Runtime ledger

${body}
`;
}

export function parseRuntimeLedger(markdown) {
  const text = String(markdown ?? "");
  if (!/^---[\s\S]*loopit-runtime-ledger:\s*1/m.test(text)) return [];
  return text
    .split(/\n(?=## Iteration \d+ — )/)
    .map((block) => {
      const heading = block.match(/^## Iteration (\d+) — (.*)$/m);
      if (!heading) return null;
      return {
        number: Number(heading[1]),
        title: line(heading[2]),
        id: field(block, "ID"),
        runId: field(block, "Run"),
        loopRevision: Number(field(block, "Loop revision")) || null,
        assignmentId: field(block, "Assignment"),
        outcome: field(block, "Outcome"),
        progress: field(block, "Progress"),
        startedAt: field(block, "Started") || null,
        finishedAt: field(block, "Finished") || null,
        fromVersion: Number(field(block, "State").split("→")[0]) || null,
        toVersion: Number(field(block, "State").split("→")[1]) || null,
        reportPath: field(block, "Report"),
        completed: field(block, "Completed"),
        next: field(block, "Next"),
        reason: field(block, "Reason"),
        stateChanges: bullets(section(block, "State changes")),
        frontierChanges: bullets(section(block, "Frontier changes")),
        relaxations: bullets(section(block, "Requirement relaxations")),
      };
    })
    .filter(Boolean);
}
