const ITEM_KINDS = new Set(["artifact", "belief", "failure", "uncertainty"]);
const FRONTIER_STATUSES = new Set([
  "ready",
  "active",
  "waiting",
  "retired",
]);
const DECISION_STATUSES = new Set(["waiting", "resolved", "deferred"]);
const AUTONOMY_MODES = new Set(["guided", "unattended"]);

function cleanLine(value, fallback = "") {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function uniqueLines(values, limit = Number.POSITIVE_INFINITY) {
  return [...new Set((values ?? []).map((value) => cleanLine(value)).filter(Boolean))]
    .slice(0, limit);
}

function safeId(value, fallback) {
  const id = cleanLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function initialContent(value, fallback) {
  const source = cleanLine(value, fallback);
  const match = source.match(/^`([^`]+)`\s*[—-]\s*(.+)$/);
  if (!match) {
    return {
      name: source,
      status: null,
      summary: source,
    };
  }
  const [name, status = null] = match[1]
    .split(/\s+·\s+/)
    .map((part) => cleanLine(part))
    .filter(Boolean);
  return {
    name: name || fallback,
    status,
    summary: cleanLine(match[2], source),
  };
}

function initialRetirementEvidence(summary, fallback) {
  const match = cleanLine(summary).match(
    /(?:retired by|done when|complete when)\s+(.+?)(?:[.;]|$)/i,
  );
  return match?.[1]
    ? `${cleanLine(match[1])}.`
    : fallback;
}

function yamlValue(value) {
  return cleanLine(value).replace(/:/g, " -");
}

function listMarkdown(items) {
  const values = uniqueLines(items);
  return values.length ? values.map((item) => `- ${item}`).join("\n") : "_None._";
}

function frontMatter(markdown) {
  const match = String(markdown ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const values = {};
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }
  return { source: match?.[0] ?? "", values };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function section(markdown, heading, level = 2) {
  const hashes = "#".repeat(level);
  return (
    String(markdown ?? "").match(
      new RegExp(
        `(?:^|\\n)${hashes} ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n${hashes} |$)`,
      ),
    )?.[1]?.trim() ?? ""
  );
}

function paragraph(markdown, heading) {
  const source = section(markdown, heading, 3);
  return cleanLine(source.split(/\n(?=- )/)[0]);
}

function listSection(markdown, heading) {
  return section(markdown, heading, 3)
    .split(/\r?\n/)
    .filter((line) => /^-\s+/.test(line))
    .map((line) => cleanLine(line.replace(/^-\s+/, "")))
    .filter(Boolean);
}

function h3Blocks(markdown) {
  const blocks = [];
  const pattern = /(?:^|\n)### `([^`]+)` — ([^\n]+)\n([\s\S]*?)(?=\n### `|$)/g;
  for (const match of String(markdown ?? "").matchAll(pattern)) {
    blocks.push({
      id: cleanLine(match[1]),
      name: cleanLine(match[2]),
      body: match[3].trim(),
    });
  }
  return blocks;
}

function field(block, label) {
  const value = String(block ?? "").match(
    new RegExp(`(?:^|\\n)- ${escapeRegExp(label)}:\\s*(.*)$`, "im"),
  )?.[1];
  return cleanLine(value).replace(/^`|`$/g, "");
}

function repeatedField(block, label) {
  const values = [];
  const pattern = new RegExp(
    `(?:^|\\n)- ${escapeRegExp(label)}:\\s*(.*)$`,
    "gim",
  );
  for (const match of String(block ?? "").matchAll(pattern)) {
    const value = cleanLine(match[1]);
    if (value) values.push(value);
  }
  return values;
}

function normalizeAutonomy(autonomy = {}) {
  const mode = AUTONOMY_MODES.has(autonomy.mode)
    ? autonomy.mode
    : "guided";
  const maxIterations = Number(autonomy.maxIterations);
  return {
    mode,
    runUntil: cleanLine(autonomy.runUntil) || null,
    maxIterations:
      Number.isInteger(maxIterations) && maxIterations > 0
        ? maxIterations
        : null,
  };
}

export function normalizeRuntimeState(state) {
  const now = new Date().toISOString();
  const direction = state?.direction ?? {};
  const seenItemIds = new Set();
  const items = (state?.items ?? []).map((item, index) => {
    let id = safeId(item.id, `state-${String(index + 1).padStart(3, "0")}`);
    while (seenItemIds.has(id)) id = `${id}-${index + 1}`;
    seenItemIds.add(id);
    return {
      id,
      kind: ITEM_KINDS.has(item.kind) ? item.kind : "uncertainty",
      name: cleanLine(item.name, `State item ${index + 1}`),
      status: cleanLine(item.status, "unverified"),
      summary: cleanLine(item.summary, "No summary recorded."),
      evidence: uniqueLines(item.evidence),
    };
  });

  const seenFrontierIds = new Set();
  const frontier = (state?.frontier ?? []).map((item, index) => {
    let id = safeId(
      item.id,
      `frontier-${String(index + 1).padStart(3, "0")}`,
    );
    while (seenFrontierIds.has(id)) id = `${id}-${index + 1}`;
    seenFrontierIds.add(id);
    const priority = Number(item.priority);
    return {
      id,
      title: cleanLine(item.title, `Next work ${index + 1}`),
      status: FRONTIER_STATUSES.has(item.status) ? item.status : "ready",
      priority: Number.isFinite(priority)
        ? Math.max(0, Math.min(100, Math.round(priority)))
        : Math.max(1, 100 - index * 10),
      objectiveLink: cleanLine(
        item.objectiveLink,
        direction.northStar ?? "Advance the declared objective.",
      ),
      causedBy: cleanLine(item.causedBy, "Current state has an unresolved gap."),
      retirementEvidence: cleanLine(
        item.retirementEvidence,
        "Observable evidence demonstrates that this work is resolved.",
      ),
    };
  });

  const seenDecisionIds = new Set();
  const decisions = (state?.decisions ?? []).map((item, index) => {
    let id = safeId(
      item.id,
      `decision-${String(index + 1).padStart(3, "0")}`,
    );
    while (seenDecisionIds.has(id)) id = `${id}-${index + 1}`;
    seenDecisionIds.add(id);
    return {
      id,
      question: cleanLine(item.question, `Decision ${index + 1}`),
      status: DECISION_STATUSES.has(item.status) ? item.status : "waiting",
      context: cleanLine(item.context, "No additional context recorded."),
      recommendation: cleanLine(
        item.recommendation,
        "Review the evidence and choose the safest objective-aligned option.",
      ),
    };
  });

  const active = state?.activeAssignment;
  const activeAssignment = active
    ? {
        id: safeId(active.id, "active-assignment"),
        frontierId: safeId(active.frontierId, "frontier-unknown"),
        title: cleanLine(active.title, "Active assignment"),
        objective: cleanLine(
          active.objective,
          direction.currentObjective ?? direction.northStar,
        ),
        status: cleanLine(active.status, "active"),
        startedAt: cleanLine(active.startedAt) || now,
        reportPath: cleanLine(active.reportPath),
      }
    : null;

  return {
    schemaVersion: 1,
    version: Math.max(1, Number(state?.version) || 1),
    loopRevision: Math.max(1, Number(state?.loopRevision) || 1),
    updatedAt: cleanLine(state?.updatedAt) || now,
    status: cleanLine(state?.status, "ready"),
    autonomy: normalizeAutonomy(state?.autonomy),
    direction: {
      northStar: cleanLine(
        direction.northStar,
        "Advance the declared project objective.",
      ),
      currentDirection: cleanLine(
        direction.currentDirection,
        direction.northStar ?? "Advance the declared project objective.",
      ),
      currentObjective: cleanLine(
        direction.currentObjective,
        direction.currentDirection ?? direction.northStar,
      ),
      better: uniqueLines(direction.better),
      hardRequirements: uniqueLines(direction.hardRequirements),
      flexibleRequirements: uniqueLines(direction.flexibleRequirements),
    },
    items,
    frontier,
    decisions,
    activeAssignment,
  };
}

export function createInitialRuntimeState(loop, autonomy = {}) {
  const statePackage = loop.startingPackage?.find(
    (item) => item.role === "state",
  );
  const frontierPackage = loop.startingPackage?.find(
    (item) => item.role === "frontier",
  );
  const foundation = loop.startingPackage?.find(
    (item) => item.role === "foundation",
  );
  const firstWork = loop.startingPackage?.find(
    (item) => item.role === "first-work",
  );
  const stateItems = [];
  for (const [index, value] of (statePackage?.initialContents ?? []).entries()) {
    const content = initialContent(
      value,
      statePackage?.name ?? "Current understanding",
    );
    stateItems.push({
      id: `understanding-${String(index + 1).padStart(3, "0")}`,
      kind: "belief",
      name: content.name,
      status: content.status ?? "unverified",
      summary:
        content.summary ||
        statePackage?.description ||
        "Initial project understanding.",
      evidence: [`Starting package: ${statePackage?.name ?? "state"}`],
    });
  }
  for (const [index, value] of (foundation?.initialContents ?? []).entries()) {
    const content = initialContent(
      value,
      foundation?.name ?? "Working foundation",
    );
    stateItems.push({
      id: `foundation-${String(index + 1).padStart(3, "0")}`,
      kind: "artifact",
      name: content.name,
      status: content.status ?? "proposed",
      summary:
        content.summary ||
        foundation?.description ||
        "Initial working foundation.",
      evidence: [`Starting package: ${foundation?.name ?? "foundation"}`],
    });
  }

  const firstWorkContent = initialContent(
    firstWork?.initialContents?.[0] ?? firstWork?.name,
    firstWork?.name ?? "First work",
  );
  const frontierContents = [
    ...(firstWork
      ? [
          {
            ...firstWorkContent,
            source: `Selected first work: ${firstWork.name}`,
            retirementEvidence:
              firstWork.description ??
              "The iteration report contains observable evidence that resolves this item.",
          },
        ]
      : []),
    ...(frontierPackage?.initialContents ?? []).map((value) => ({
      ...initialContent(value, frontierPackage?.name ?? "Unresolved work"),
      source: `Initial frontier: ${frontierPackage?.name ?? "unresolved work"}`,
      retirementEvidence: initialRetirementEvidence(
        initialContent(value, frontierPackage?.name ?? "Unresolved work").summary,
        "The iteration report contains observable evidence that resolves this item.",
      ),
    })),
  ].filter(
    (entry, index, entries) =>
      entries.findIndex((candidate) => candidate.name === entry.name) === index,
  );
  const frontier = frontierContents.map((content, index) => ({
    id: `frontier-${String(index + 1).padStart(3, "0")}`,
    title: content.name,
    status: "ready",
    priority: Math.max(1, 100 - index * 10),
    objectiveLink: loop.objective,
    causedBy: `${content.source}. ${content.summary}`,
    retirementEvidence: content.retirementEvidence,
  }));
  if (!frontier.length) {
    frontier.push({
      id: "frontier-001",
      title: firstWork?.name ?? `Advance ${loop.name}`,
      status: "ready",
      priority: 100,
      objectiveLink: loop.objective,
      causedBy: "The runtime has not yet produced evidence for the objective.",
      retirementEvidence:
        firstWork?.description ??
        "A report demonstrates one observable objective-aligned improvement.",
    });
  }

  const better = uniqueLines(
    [
      ...loop.boundaries
        .filter((boundary) => boundary.kind === "complete")
        .map((boundary) => boundary.description),
      ...loop.states
        .filter((state) => ["evaluate", "challenge"].includes(state.kind))
        .map((state) => state.completion),
    ],
    6,
  );

  return normalizeRuntimeState({
    schemaVersion: 1,
    version: 1,
    loopRevision: loop.revision,
    updatedAt: new Date().toISOString(),
    status: "ready",
    autonomy,
    direction: {
      northStar: loop.objective,
      currentDirection: `Advance ${loop.name} through evidence-backed iterations.`,
      currentObjective:
        firstWorkContent.name ?? firstWork?.name ?? frontier[0].title,
      better: better.length ? better : [loop.objective],
      hardRequirements: loop.boundaries
        .filter((boundary) => boundary.kind !== "complete")
        .map((boundary) => `${boundary.name}: ${boundary.description}`),
      flexibleRequirements: [
        "Implementation methods may change when evidence supports a better objective-aligned path.",
      ],
    },
    items: stateItems,
    frontier,
    decisions: [],
    activeAssignment: null,
  });
}

export function serializeRuntimeState(input) {
  const state = normalizeRuntimeState(input);
  const itemMarkdown = state.items.length
    ? state.items
        .map(
          (item) => `### \`${item.id}\` — ${item.name}
- Kind: \`${item.kind}\`
- Status: ${item.status}
- Summary: ${item.summary}
${item.evidence.length ? item.evidence.map((entry) => `- Evidence: ${entry}`).join("\n") : "- Evidence: No evidence recorded."}`,
        )
        .join("\n\n")
    : "_No state items recorded._";
  const frontierMarkdown = state.frontier.length
    ? [...state.frontier]
        .sort((left, right) => right.priority - left.priority)
        .map(
          (item) => `### \`${item.id}\` — ${item.title}
- Status: \`${item.status}\`
- Priority: ${item.priority}
- Objective: ${item.objectiveLink}
- Caused by: ${item.causedBy}
- Retire when: ${item.retirementEvidence}`,
        )
        .join("\n\n")
    : "_No frontier items recorded._";
  const decisionMarkdown = state.decisions.length
    ? state.decisions
        .map(
          (item) => `### \`${item.id}\` — ${item.question}
- Status: \`${item.status}\`
- Context: ${item.context}
- Recommendation: ${item.recommendation}`,
        )
        .join("\n\n")
    : "_No human decisions are waiting._";
  const active = state.activeAssignment
    ? `- ID: \`${state.activeAssignment.id}\`
- Frontier: \`${state.activeAssignment.frontierId}\`
- Title: ${state.activeAssignment.title}
- Objective: ${state.activeAssignment.objective}
- Status: \`${state.activeAssignment.status}\`
- Started: ${state.activeAssignment.startedAt}
- Report: ${state.activeAssignment.reportPath || "Not written yet"}`
    : "_No assignment is currently active._";

  return `---
loopit-runtime-state: 1
version: ${state.version}
loop-revision: ${state.loopRevision}
updated-at: ${state.updatedAt}
status: ${yamlValue(state.status)}
autonomy: ${state.autonomy.mode}
run-until: ${state.autonomy.runUntil ?? ""}
max-iterations: ${state.autonomy.maxIterations ?? ""}
---

# Runtime state

## Direction

### North star

${state.direction.northStar}

### Current direction

${state.direction.currentDirection}

### Current objective

${state.direction.currentObjective}

### What better means

${listMarkdown(state.direction.better)}

### What must stay true

${listMarkdown(state.direction.hardRequirements)}

### What may change

${listMarkdown(state.direction.flexibleRequirements)}

## State items

${itemMarkdown}

## Frontier

${frontierMarkdown}

## Waiting decisions

${decisionMarkdown}

## Active assignment

${active}
`;
}

export function parseRuntimeStateMarkdown(markdown) {
  const { values } = frontMatter(markdown);
  if (values["loopit-runtime-state"] !== "1") {
    throw new Error("Runtime state is missing loopit-runtime-state: 1.");
  }
  const directionSource = section(markdown, "Direction");
  const itemSource = section(markdown, "State items");
  const frontierSource = section(markdown, "Frontier");
  const decisionSource = section(markdown, "Waiting decisions");
  const activeSource = section(markdown, "Active assignment");
  const activeId = field(activeSource, "ID");

  return normalizeRuntimeState({
    schemaVersion: 1,
    version: Number(values.version) || 1,
    loopRevision: Number(values["loop-revision"]) || 1,
    updatedAt: values["updated-at"],
    status: values.status,
    autonomy: {
      mode: values.autonomy,
      runUntil: values["run-until"] || null,
      maxIterations: Number(values["max-iterations"]) || null,
    },
    direction: {
      northStar: paragraph(directionSource, "North star"),
      currentDirection: paragraph(directionSource, "Current direction"),
      currentObjective: paragraph(directionSource, "Current objective"),
      better: listSection(directionSource, "What better means"),
      hardRequirements: listSection(directionSource, "What must stay true"),
      flexibleRequirements: listSection(directionSource, "What may change"),
    },
    items: h3Blocks(itemSource).map((block) => ({
      id: block.id,
      name: block.name,
      kind: field(block.body, "Kind"),
      status: field(block.body, "Status"),
      summary: field(block.body, "Summary"),
      evidence: repeatedField(block.body, "Evidence").filter(
        (value) => value !== "No evidence recorded.",
      ),
    })),
    frontier: h3Blocks(frontierSource).map((block) => ({
      id: block.id,
      title: block.name,
      status: field(block.body, "Status"),
      priority: Number(field(block.body, "Priority")),
      objectiveLink: field(block.body, "Objective"),
      causedBy: field(block.body, "Caused by"),
      retirementEvidence: field(block.body, "Retire when"),
    })),
    decisions: h3Blocks(decisionSource).map((block) => ({
      id: block.id,
      question: block.name,
      status: field(block.body, "Status"),
      context: field(block.body, "Context"),
      recommendation: field(block.body, "Recommendation"),
    })),
    activeAssignment: activeId
      ? {
          id: activeId,
          frontierId: field(activeSource, "Frontier"),
          title: field(activeSource, "Title"),
          objective: field(activeSource, "Objective"),
          status: field(activeSource, "Status"),
          startedAt: field(activeSource, "Started"),
          reportPath: field(activeSource, "Report"),
        }
      : null,
  });
}

export function selectRuntimeAssignment(stateInput, loop, iterationId, now) {
  const state = normalizeRuntimeState(stateInput);
  if (state.activeAssignment) {
    return {
      state,
      assignment: {
        ...state.activeAssignment,
        rationale: "Resume the interrupted durable assignment.",
        instructions: loop.states.map(
          (loopState) => `${loopState.name}: ${loopState.instruction}`,
        ),
        deliverables: loop.artifacts.map(
          (artifact) => `${artifact.name}: ${artifact.description}`,
        ),
        evidence: loop.states.map(
          (loopState) => `${loopState.name}: ${loopState.completion}`,
        ),
      },
    };
  }
  const selected = [...state.frontier]
    .filter((item) => item.status === "ready")
    .sort((left, right) => right.priority - left.priority)[0];
  if (!selected) return { state, assignment: null };

  const reportPath = `.loopit/runtime/reports/${iterationId}.md`;
  const assignment = {
    id: iterationId,
    frontierId: selected.id,
    title: selected.title,
    objective: selected.objectiveLink,
    status: "active",
    startedAt: now,
    reportPath,
    rationale: selected.causedBy,
    instructions: loop.states.map(
      (loopState) => `${loopState.name}: ${loopState.instruction}`,
    ),
    deliverables: loop.artifacts.map(
      (artifact) => `${artifact.name}: ${artifact.description}`,
    ),
    evidence: [
      selected.retirementEvidence,
      ...loop.states.map(
        (loopState) => `${loopState.name}: ${loopState.completion}`,
      ),
    ],
  };
  const nextState = normalizeRuntimeState({
    ...state,
    version: state.version + 1,
    updatedAt: now,
    status: "running",
    direction: {
      ...state.direction,
      currentObjective: selected.title,
    },
    frontier: state.frontier.map((item) =>
      item.id === selected.id ? { ...item, status: "active" } : item,
    ),
    activeAssignment: assignment,
  });
  return { state: nextState, assignment };
}

export function serializeRuntimeAssignment(assignment, stateVersion) {
  return `---
loopit-runtime-assignment: 1
assignment-id: ${assignment.id}
frontier-id: ${assignment.frontierId}
state-version: ${stateVersion}
started-at: ${assignment.startedAt}
status: ${assignment.status}
---

# ${assignment.title}

## Objective

${assignment.objective}

## Why this work exists

${assignment.rationale}

## Instructions

${listMarkdown(assignment.instructions)}

## Expected deliverables

${listMarkdown(assignment.deliverables)}

## Required evidence

${listMarkdown(assignment.evidence)}

## Worker boundary

- Execute this bounded assignment against the target project.
- Do not edit files under \`.loopit/\`; Loopit owns state, reports, and the ledger.
- Record partial and failed outcomes honestly.
- End with a detailed report that another agent can audit without hidden chat context.
`;
}

export function integrationState(currentState, integration, now) {
  return normalizeRuntimeState({
    ...currentState,
    version: currentState.version + 1,
    updatedAt: now,
    status:
      integration.outcome === "continue"
        ? "ready"
        : integration.outcome === "complete"
          ? "completed"
          : "paused",
    direction: integration.direction,
    items: integration.items,
    frontier: integration.frontier,
    decisions: integration.decisions,
    activeAssignment: null,
    autonomy: currentState.autonomy,
  });
}

export const runtimeStateEnums = {
  itemKinds: [...ITEM_KINDS],
  frontierStatuses: [...FRONTIER_STATUSES],
  decisionStatuses: [...DECISION_STATUSES],
  autonomyModes: [...AUTONOMY_MODES],
};
