import type {
  LoopDefinition,
  LoopState,
  ValidationFinding,
} from "./loop-types";
import { primarySequence } from "./loop-flow.ts";

function finding(
  id: string,
  severity: ValidationFinding["severity"],
  title: string,
  detail: string,
  elementId?: string,
): ValidationFinding {
  return { id, severity, title, detail, elementId };
}

function reachableStates(
  loop: LoopDefinition,
  stateMap: Map<string, LoopState>,
  canTraverse: (transition: LoopState["transitions"][number]) => boolean =
    () => true,
) {
  const reachable = new Set<string>();
  const queue = stateMap.has(loop.startState) ? [loop.startState] : [];

  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const state = stateMap.get(id);
    state?.transitions.forEach((transition) => {
      if (
        canTraverse(transition) &&
        stateMap.has(transition.to) &&
        !reachable.has(transition.to)
      ) {
        queue.push(transition.to);
      }
    });
  }

  return reachable;
}

function canReachTransitionKind(
  startId: string,
  stateMap: Map<string, LoopState>,
  kind: "complete",
  canTraverse: (transition: LoopState["transitions"][number]) => boolean =
    () => true,
) {
  const visited = new Set<string>();
  const queue = stateMap.has(startId) ? [startId] : [];

  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const state = stateMap.get(id);
    if (state?.transitions.some((transition) => transition.kind === kind)) {
      return true;
    }
    state?.transitions.forEach((transition) => {
      if (
        canTraverse(transition) &&
        stateMap.has(transition.to) &&
        !visited.has(transition.to)
      ) {
        queue.push(transition.to);
      }
    });
  }

  return false;
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

  const sequence = primarySequence(loop);
  const cycle = sequence.loopBack
    ? [
        ...sequence.states
          .slice(sequence.loopBack.targetIndex)
          .map((state) => state.id),
        sequence.loopBack.targetId,
      ]
    : [];
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

  const challengeStates = loop.states.filter(
    (state) => state.kind === "challenge",
  );
  const completionRequiresChallenge =
    loop.completionPolicy === "confirm" ||
    loop.completionPolicy === "automatic";

  if (completionRequiresChallenge && challengeStates.length === 0) {
    findings.push(
      finding(
        "missing-completion-challenge",
        "error",
        "Candidate completion is not challenged",
        "Add a fresh completion-challenge state before the project can be accepted.",
      ),
    );
  }

  if (completionRequiresChallenge && challengeStates.length > 0) {
    const stateMapWithoutChallenge = new Map(
      loop.states
        .filter((state) => state.kind !== "challenge")
        .map((state) => [state.id, state]),
    );
    const reachableWithoutChallenge = reachableStates(
      loop,
      stateMapWithoutChallenge,
      (transition) => !/challeng/i.test(transition.when),
    );
    const bypassSource = loop.states.find(
      (state) =>
        reachableWithoutChallenge.has(state.id) &&
        state.transitions.some((transition) => transition.kind === "complete"),
    );

    if (bypassSource) {
      findings.push(
        finding(
          "completion-bypasses-challenge",
          "error",
          "Completion can bypass its challenger",
          `“${bypassSource.name}” can accept the project along a path that never passes through a fresh completion challenge.`,
          bypassSource.id,
        ),
      );
    }
  }

  for (const state of challengeStates) {
    const hasReturnToWork = state.transitions.some((transition) => {
      const target = stateMap.get(transition.to);
      return (
        (transition.kind === "normal" || transition.kind === "continue") &&
        target?.kind !== "challenge" &&
        target?.kind !== "interrupt" &&
        target?.kind !== "terminal"
      );
    });

    if (!hasReturnToWork) {
      findings.push(
        finding(
          `challenge-cannot-continue-${state.id}`,
          "error",
          `${state.name} cannot reopen the work`,
          "A completion challenge must route agent-owned gaps back into continuing work.",
          state.id,
        ),
      );
    }

    if (
      loop.completionPolicy === "confirm" &&
      !state.transitions.some((transition) => transition.kind === "interrupt")
    ) {
      findings.push(
        finding(
          `challenge-missing-confirmation-${state.id}`,
          "error",
          `${state.name} cannot request acceptance`,
          "The human-confirmation policy needs an interrupt from the challenged candidate to a focused acceptance decision.",
          state.id,
        ),
      );
    }

    if (
      loop.completionPolicy === "confirm" &&
      !canReachTransitionKind(state.id, stateMap, "complete")
    ) {
      findings.push(
        finding(
          `challenge-missing-acceptance-${state.id}`,
          "error",
          `${state.name} cannot reach an accepted outcome`,
          "The confirmation path must lead from the challenged candidate to an explicit human acceptance transition.",
          state.id,
        ),
      );
    }

    if (
      loop.completionPolicy === "automatic" &&
      !canReachTransitionKind(
        state.id,
        stateMap,
        "complete",
        (transition) => transition.kind !== "interrupt",
      )
    ) {
      findings.push(
        finding(
          `challenge-missing-auto-acceptance-${state.id}`,
          "error",
          `${state.name} cannot accept proven completion`,
          "The evidence-based policy needs a reachable acceptance path after the challenge passes.",
          state.id,
        ),
      );
    }
  }

  if (
    loop.completionPolicy === "continuous" &&
    boundaryKinds.has("complete")
  ) {
    findings.push(
      finding(
        "continuous-has-completion",
        "warning",
        "The continuous loop can terminate itself",
        "Confirm that this completion exit is an intentional boundary; otherwise return new findings to the frontier and pause only for a human, budget, or declared limit.",
      ),
    );
  } else if (!boundaryKinds.has("complete")) {
    findings.push(
      finding(
        "missing-completion",
        completionRequiresChallenge ? "error" : "pass",
        "No completion path is defined",
        completionRequiresChallenge
          ? "Describe the acceptance path after candidate completion is challenged."
          : "This matches the continuous policy: new findings return to the frontier until an explicit pause boundary is reached.",
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
