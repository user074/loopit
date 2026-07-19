function cleanInline(value) {
  return value.trim().replace(/^`([^`]*)`$/, "$1");
}

function requiredMatch(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function parseFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  requiredMatch(match, "The loop document must begin with Markdown front matter.");

  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid front-matter line: ${line}`);
    }
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function headingSection(source, level, title) {
  const marker = "#".repeat(level);
  const heading = new RegExp(`^${marker}\\s+${title}\\s*$`, "mi");
  const match = heading.exec(source);
  requiredMatch(match, `Missing Markdown section: ${marker} ${title}`);

  const start = match.index + match[0].length;
  const rest = source.slice(start);
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`, "m").exec(rest);
  return rest.slice(0, nextHeading?.index ?? rest.length).trim();
}

function entrySections(source, level) {
  const marker = "#".repeat(level);
  const heading = new RegExp(`^${marker}\\s+(.+)\\s*$`, "gm");
  const matches = [...source.matchAll(heading)];

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    return { title: match[1].trim(), body: source.slice(start, end).trim() };
  });
}

function field(source, label) {
  const match = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, "mi").exec(
    source,
  );
  requiredMatch(match, `Missing required field: ${label}`);
  return cleanInline(match[1]);
}

function listSection(source, title) {
  return headingSection(source, 4, title)
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => cleanInline(line.replace(/^\s*-\s+/, "")));
}

function proseSection(source, title) {
  return headingSection(source, 4, title).trim();
}

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  const cells = [];
  let cell = "";
  const content = trimmed.slice(1, -1);
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\\" && content[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (content[index] === "|") {
      cells.push(cleanInline(cell));
      cell = "";
    } else {
      cell += content[index];
    }
  }
  cells.push(cleanInline(cell));
  return cells;
}

function parseTransitions(source) {
  const table = headingSection(source, 4, "Transitions");
  const rows = table
    .split(/\r?\n/)
    .map(tableCells)
    .filter((cells) => cells.length > 0)
    .filter((cells) => cells[0].toLowerCase() !== "next state")
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));

  return rows.map((cells) => {
    if (cells.length !== 4) {
      throw new Error(
        "Every transition table row must contain Next state, When, Kind, and ID.",
      );
    }
    const [to, when, kind, id] = cells;
    if (!id || !to || !when) {
      throw new Error("Transition ID, target, and condition cannot be empty.");
    }
    return {
      id,
      to,
      when,
      kind: oneOf(
        kind,
        ["normal", "continue", "interrupt", "complete"],
        `Transition ${id} kind`,
      ),
    };
  });
}

/**
 * Parse Loopit's constrained Markdown contract into the internal graph used by
 * the validator and web UI. Markdown remains the only durable loop definition.
 */
export function parseLoopMarkdown(source) {
  const meta = parseFrontMatter(source);
  const title = requiredMatch(
    /^#\s+([^#].*)$/m.exec(source),
    "The loop document needs a level-one title.",
  )[1].trim();

  const artifacts = entrySections(headingSection(source, 2, "Artifacts"), 3).map(
    ({ title: name, body }) => ({
      id: field(body, "ID"),
      name,
      description: field(body, "Description"),
    }),
  );

  const boundaries = entrySections(
    headingSection(source, 2, "Boundaries"),
    3,
  ).map(({ title: name, body }) => {
    const id = field(body, "ID");
    return {
      id,
      name,
      kind: oneOf(
        field(body, "Kind"),
        ["interrupt", "complete", "budget"],
        `Boundary ${id} kind`,
      ),
      description: field(body, "Description"),
    };
  });

  const states = entrySections(headingSection(source, 2, "States"), 3).map(
    ({ title: name, body }) => {
      const id = field(body, "ID");
      return {
        id,
        name,
        kind: oneOf(
          field(body, "Kind"),
          [
            "observe",
            "decide",
            "act",
            "evaluate",
            "update",
            "interrupt",
            "terminal",
          ],
          `State ${id} kind`,
        ),
        summary: field(body, "Summary"),
        reads: listSection(body, "Reads"),
        instruction: proseSection(body, "Instruction"),
        writes: listSection(body, "Writes"),
        completion: proseSection(body, "Completion"),
        transitions: parseTransitions(body),
      };
    },
  );

  const schemaVersion = Number(meta.loopit);
  const revision = Number(meta.revision);
  if (schemaVersion !== 1) throw new Error("Front matter loopit must be 1.");
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error("Front matter revision must be a positive integer.");
  }

  return {
    schemaVersion,
    revision,
    name: title,
    objective: headingSection(source, 2, "Objective"),
    status: oneOf(meta.status, ["draft", "confirmed"], "Front matter status"),
    startState: requiredMatch(meta.start, "Front matter start is required."),
    artifacts,
    boundaries,
    states,
  };
}

function oneLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function tableValue(value) {
  return oneLine(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function bulletList(values) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "_None._";
}

function transitionTable(transitions) {
  const rows = transitions.map(
    (transition) =>
      `| \`${tableValue(transition.to)}\` | ${tableValue(transition.when)} | \`${tableValue(transition.kind)}\` | \`${tableValue(transition.id)}\` |`,
  );
  return [
    "| Next state | When | Kind | ID |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Serialize the editable internal graph back to Loopit's Markdown contract. */
export function serializeLoopMarkdown(loop) {
  const artifacts = loop.artifacts
    .map(
      (artifact) => `### ${oneLine(artifact.name)}

**ID:** \`${oneLine(artifact.id)}\`
**Description:** ${oneLine(artifact.description)}`,
    )
    .join("\n\n");

  const boundaries = loop.boundaries
    .map(
      (boundary) => `### ${oneLine(boundary.name)}

**ID:** \`${oneLine(boundary.id)}\`
**Kind:** \`${oneLine(boundary.kind)}\`
**Description:** ${oneLine(boundary.description)}`,
    )
    .join("\n\n");

  const states = loop.states
    .map(
      (state) => `### ${oneLine(state.name)}

**ID:** \`${oneLine(state.id)}\`
**Kind:** \`${oneLine(state.kind)}\`
**Summary:** ${oneLine(state.summary)}

#### Reads

${bulletList(state.reads)}

#### Instruction

${state.instruction.trim()}

#### Writes

${bulletList(state.writes)}

#### Completion

${state.completion.trim()}

#### Transitions

${transitionTable(state.transitions)}`,
    )
    .join("\n\n");

  return `---
loopit: 1
revision: ${Number(loop.revision)}
status: ${oneLine(loop.status)}
start: ${oneLine(loop.startState)}
---

# ${oneLine(loop.name)}

## Objective

${loop.objective.trim()}

## Artifacts

${artifacts}

## Boundaries

${boundaries}

## States

${states}
`;
}
