import type {
  LoopDefinition,
  LoopState,
  ValidationFinding,
} from "./loop-types";

function finding(
  id: string,
  severity: ValidationFinding["severity"],
  title: string,
  detail: string,
  elementId?: string,
): ValidationFinding {
  return { id, severity, title, detail, elementId };
}

function reachableStates(loop: LoopDefinition, stateMap: Map<string, LoopState>) {
  const reachable = new Set<string>();
  const queue = stateMap.has(loop.startState) ? [loop.startState] : [];

  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const state = stateMap.get(id);
    state?.transitions.forEach((transition) => {
      if (stateMap.has(transition.to) && !reachable.has(transition.to)) {
        queue.push(transition.to);
      }
    });
  }

  return reachable;
}

function findReachableCycle(
  loop: LoopDefinition,
  stateMap: Map<string, LoopState>,
) {
  const visited = new Set<string>();
  const active = new Set<string>();
  let cycle: string[] = [];

  function visit(id: string, path: string[]): boolean {
    if (active.has(id)) {
      const start = path.indexOf(id);
      cycle = [...path.slice(start), id];
      return true;
    }
    if (visited.has(id)) return false;

    visited.add(id);
    active.add(id);
    const nextPath = [...path, id];
    const state = stateMap.get(id);

    for (const transition of state?.transitions ?? []) {
      if (stateMap.has(transition.to) && visit(transition.to, nextPath)) {
        return true;
      }
    }

    active.delete(id);
    return false;
  }

  if (stateMap.has(loop.startState)) visit(loop.startState, []);
  return cycle;
}

export function validateLoop(loop: LoopDefinition): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const stateIds = loop.states.map((state) => state.id);
  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const duplicateIds = stateIds.filter(
    (id, index) => stateIds.indexOf(id) !== index,
  );

  if (!stateMap.has(loop.startState)) {
    findings.push(
      finding(
        "missing-start",
        "error",
        "Start state is missing",
        `The declared start state “${loop.startState}” does not exist.`,
      ),
    );
  } else {
    findings.push(
      finding(
        "start-found",
        "pass",
        "Start state is defined",
        `The loop begins at “${stateMap.get(loop.startState)?.name}”.`,
        loop.startState,
      ),
    );
  }

  if (duplicateIds.length) {
    findings.push(
      finding(
        "duplicate-states",
        "error",
        "State identifiers must be unique",
        `Duplicate identifiers: ${[...new Set(duplicateIds)].join(", ")}.`,
        duplicateIds[0],
      ),
    );
  }

  for (const state of loop.states) {
    if (!state.instruction.trim() || !state.completion.trim()) {
      findings.push(
        finding(
          `incomplete-contract-${state.id}`,
          "error",
          `${state.name} has an incomplete contract`,
          "Every state needs both an instruction and a completion condition.",
          state.id,
        ),
      );
    }

    if (state.kind !== "terminal" && state.transitions.length === 0) {
      findings.push(
        finding(
          `dead-end-${state.id}`,
          "error",
          `${state.name} is a dead end`,
          "Add a continuation, interrupt, or completion transition.",
          state.id,
        ),
      );
    }

    for (const transition of state.transitions) {
      if (!stateMap.has(transition.to)) {
        findings.push(
          finding(
            `dangling-${transition.id}`,
            "error",
            `${state.name} points to a missing state`,
            `The transition target “${transition.to}” does not exist.`,
            state.id,
          ),
        );
      }
      if (!transition.when.trim()) {
        findings.push(
          finding(
            `missing-condition-${transition.id}`,
            "warning",
            `${state.name} has an unexplained transition`,
            "Describe the evidence or condition that selects this path.",
            state.id,
          ),
        );
      }
    }
  }

  const reachable = reachableStates(loop, stateMap);
  const unreachable = loop.states.filter((state) => !reachable.has(state.id));
  if (unreachable.length) {
    findings.push(
      finding(
        "unreachable-states",
        "warning",
        "Some states cannot be reached",
        unreachable.map((state) => state.name).join(", "),
        unreachable[0].id,
      ),
    );
  } else if (loop.states.length) {
    findings.push(
      finding(
        "all-reachable",
        "pass",
        "All states are reachable",
        "Every state can be reached from the declared start state.",
      ),
    );
  }

  const cycle = findReachableCycle(loop, stateMap);
  if (!cycle.length) {
    findings.push(
      finding(
        "missing-cycle",
        "error",
        "No continuation cycle exists",
        "The loop can move forward, but it has no reachable path back into continuing work.",
      ),
    );
  } else {
    const names = cycle.map((id) => stateMap.get(id)?.name ?? id);
    findings.push(
      finding(
        "cycle-found",
        "pass",
        "Continuation cycle found",
        names.join(" → "),
        cycle[0],
      ),
    );

    const cycleStates = cycle
      .map((id) => stateMap.get(id))
      .filter(Boolean) as LoopState[];
    if (!cycleStates.some((state) => state.kind === "evaluate")) {
      findings.push(
        finding(
          "cycle-missing-evaluation",
          "warning",
          "The cycle does not evaluate evidence",
          "Add an evaluation state before the loop continues.",
          cycle[0],
        ),
      );
    }
    if (
      !cycleStates.some(
        (state) => state.kind === "update" && state.writes.length > 0,
      )
    ) {
      findings.push(
        finding(
          "cycle-missing-update",
          "error",
          "The cycle does not update durable state",
          "A continuing cycle must write state that the next iteration can read.",
          cycle[0],
        ),
      );
    }
  }

  const boundaryKinds = new Set(
    loop.states
      .flatMap((state) => state.transitions)
      .map((transition) => transition.kind),
  );

  if (!boundaryKinds.has("interrupt")) {
    findings.push(
      finding(
        "missing-interrupt",
        "warning",
        "No human interrupt is defined",
        "Describe when the loop should stop and ask for human judgment.",
      ),
    );
  }

  if (!boundaryKinds.has("complete")) {
    findings.push(
      finding(
        "missing-completion",
        "warning",
        "No completion path is defined",
        "Describe the evidence that would make the loop complete.",
      ),
    );
  }

  if (!findings.some((item) => item.severity === "error")) {
    findings.push(
      finding(
        "structurally-viable",
        "pass",
        "Loop is structurally viable",
        "No structural condition currently prevents a controlled test cycle.",
      ),
    );
  }

  return findings;
}
