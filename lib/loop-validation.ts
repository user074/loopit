import type {
  LoopDefinition,
  LoopState,
  ValidationFinding,
} from "./loop-types";
import { primarySequence, stateHandoff } from "./loop-flow.ts";

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
  const primaryLinks = [
    ...sequence.links,
    ...(sequence.loopBack ? [sequence.loopBack] : []),
  ];

  for (const link of primaryLinks) {
    const source = stateMap.get(link.sourceId);
    const target = stateMap.get(link.targetId);
    if (source && target && stateHandoff(source, target).length === 0) {
      findings.push(
        finding(
          `missing-handoff-${link.transition.id}`,
          "warning",
          `${source.name} does not name its handoff`,
          `Its usual next state, “${target.name}”, does not read any artifact that this state writes. Use the same artifact name on both sides so a fresh agent can follow the work.`,
          source.id,
        ),
      );
    }
  }

  const resultHandoffs = primaryLinks.flatMap((link) => {
    const source = stateMap.get(link.sourceId);
    const target = stateMap.get(link.targetId);
    if (
      !source ||
      !target ||
      source.kind !== "act" ||
      (target.kind !== "evaluate" && target.kind !== "update")
    ) {
      return [];
    }
    return stateHandoff(source, target).map((artifact) => ({
      artifact,
      source,
    }));
  });
  if (resultHandoffs.length) {
    findings.push(
      finding(
        "result-handoff-found",
        "pass",
        "A portable result handoff is defined",
        resultHandoffs.map(({ artifact }) => artifact).join(", "),
        resultHandoffs[0].source.id,
      ),
    );
  } else {
    findings.push(
      finding(
        "missing-result-handoff",
        "warning",
        "The recurring cycle has no explicit result handoff",
        "An execution state should write one named result package that its evaluation or integration state reads. Use the domain's native deliverable plus the evidence and provenance a fresh consumer needs.",
      ),
    );
  }

  const chosenTransitionIds = sequence.chosenTransitionIds;
  const recoverySourcesByTarget = new Map<string, Set<string>>();
  for (const state of loop.states) {
    for (const transition of state.transitions) {
      if (
        transition.to === state.id ||
        chosenTransitionIds.has(transition.id) ||
        !/absent|corrupt|fail|incomplete|interrupt|invalid|missing|partial|recover|tool error/i.test(
          transition.when,
        )
      ) {
        continue;
      }
      const sources = recoverySourcesByTarget.get(transition.to) ?? new Set();
      sources.add(state.id);
      recoverySourcesByTarget.set(transition.to, sources);
    }
  }
  for (const [targetId, sources] of recoverySourcesByTarget) {
    const target = stateMap.get(targetId);
    if (
      target &&
      sources.size >= 3 &&
      target.kind !== "interrupt" &&
      target.kind !== "terminal" &&
      target.kind !== "challenge"
    ) {
      findings.push(
        finding(
          `shared-fallback-${targetId}`,
          "warning",
          `Many recovery paths converge on ${target.name}`,
          `${sources.size} states use this as a recovery destination. Keep its contract narrow: repair durable records and resume their owning state without taking over ordinary pipeline outputs.`,
          targetId,
        ),
      );
    }
  }

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
    if (
      !cycleStates.some((state) => state.kind === "evaluate") &&
      resultHandoffs.length === 0
    ) {
      findings.push(
        finding(
          "cycle-missing-evaluation",
          "warning",
          "The cycle does not evaluate evidence",
          "Add an evaluation state, or let the integration state consume the execution result package before the loop continues.",
          cycle[0],
        ),
      );
    }
    if (
      !cycleStates.some(
        (state) =>
          (state.kind === "evaluate" || state.kind === "update") &&
          state.writes.length > 0,
      )
    ) {
      findings.push(
        finding(
          "cycle-missing-update",
          "error",
          "The cycle does not integrate its result",
          "The evaluation or integration state must write durable state and a frontier that the next iteration can read.",
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
  const completionNeedsAcceptance =
    loop.completionPolicy === "confirm" ||
    loop.completionPolicy === "automatic";
  const completeTransitions = loop.states.flatMap((state) =>
    state.transitions
      .filter((transition) => transition.kind === "complete")
      .map((transition) => ({ state, transition })),
  );

  if (completionNeedsAcceptance && challengeStates.length === 0) {
    for (const { state, transition } of completeTransitions) {
      const condition = transition.when.toLowerCase();
      if (!condition.includes("challeng")) {
        findings.push(
          finding(
            `completion-policy-missing-challenge-${transition.id}`,
            "error",
            "Runtime completion does not name its challenge",
            "A completion protocol may stay outside the domain graph, but its acceptance condition must still require a fresh challenge.",
            state.id,
          ),
        );
      }
      if (
        loop.completionPolicy === "confirm" &&
        !/accept|confirm/.test(condition)
      ) {
        findings.push(
          finding(
            `completion-policy-missing-confirmation-${transition.id}`,
            "error",
            "Runtime completion does not name human acceptance",
            "The confirm policy may stay outside the domain graph, but its completion condition must still require explicit human acceptance.",
            state.id,
          ),
        );
      }
    }
  }

  if (completionNeedsAcceptance && challengeStates.length > 0) {
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
        completionNeedsAcceptance ? "error" : "pass",
        "No completion path is defined",
        completionNeedsAcceptance
          ? "Describe the runtime acceptance path after candidate completion is challenged. It does not need to be a permanent domain-loop state."
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
