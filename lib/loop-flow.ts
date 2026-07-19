import type {
  LoopDefinition,
  LoopState,
  LoopTransition,
  TransitionKind,
} from "./loop-types";

export interface SequenceLink {
  sourceId: string;
  targetId: string;
  transition: LoopTransition;
}

export interface LoopBack extends SequenceLink {
  targetIndex: number;
}

export interface PrimarySequence {
  states: LoopState[];
  links: SequenceLink[];
  loopBack: LoopBack | null;
  chosenTransitionIds: Set<string>;
}

interface CycleTrace {
  stateIds: string[];
  transitions: LoopTransition[];
  targetIndex: number;
}

const TRANSITION_PRIORITY: Record<TransitionKind, number> = {
  normal: 0,
  continue: 1,
  interrupt: 2,
  complete: 3,
};

function orderedTransitions(state: LoopState) {
  return state.transitions
    .map((transition, index) => ({ transition, index }))
    .sort(
      (left, right) =>
        TRANSITION_PRIORITY[left.transition.kind] -
          TRANSITION_PRIORITY[right.transition.kind] ||
        left.index - right.index,
    )
    .map(({ transition }) => transition);
}

function scoreCycle(
  trace: CycleTrace,
  stateMap: Map<string, LoopState>,
) {
  const cycleStates = trace.stateIds
    .slice(trace.targetIndex)
    .map((id) => stateMap.get(id))
    .filter(Boolean) as LoopState[];
  const cycleTransitions = trace.transitions.slice(trace.targetIndex);
  let score = 0;

  if (cycleTransitions.some((transition) => transition.kind === "continue")) {
    score += 500;
  }
  if (cycleStates.some((state) => state.kind === "evaluate")) score += 300;
  if (
    cycleStates.some(
      (state) => state.kind === "update" && state.writes.length > 0,
    )
  ) {
    score += 200;
  }
  if (cycleStates.some((state) => state.kind === "act")) score += 80;
  if (cycleStates.some((state) => state.kind === "decide")) score += 40;
  if (
    cycleStates.some(
      (state) => state.kind === "interrupt" || state.kind === "terminal",
    )
  ) {
    score -= 1_000;
  }
  if (
    cycleTransitions.some(
      (transition) =>
        transition.kind === "interrupt" || transition.kind === "complete",
    )
  ) {
    score -= 1_000;
  }

  return score - cycleStates.length;
}

function findCycleTrace(loop: LoopDefinition): CycleTrace | null {
  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const active = new Map<string, number>();
  const stateIds: string[] = [];
  const transitions: LoopTransition[] = [];
  const traces: CycleTrace[] = [];
  let exploredPaths = 0;

  function visit(id: string) {
    const state = stateMap.get(id);
    if (!state || exploredPaths >= 10_000 || traces.length >= 512) return;

    exploredPaths += 1;
    active.set(id, stateIds.length);
    stateIds.push(id);

    for (const transition of orderedTransitions(state)) {
      if (!stateMap.has(transition.to)) continue;

      const targetIndex = active.get(transition.to);
      if (targetIndex !== undefined) {
        traces.push({
          stateIds: [...stateIds],
          transitions: [...transitions, transition],
          targetIndex,
        });
        continue;
      }

      transitions.push(transition);
      visit(transition.to);
      transitions.pop();
    }

    stateIds.pop();
    active.delete(id);
  }

  if (!stateMap.has(loop.startState)) return null;
  visit(loop.startState);
  return (
    traces.sort(
      (left, right) =>
        scoreCycle(right, stateMap) - scoreCycle(left, stateMap),
    )[0] ?? null
  );
}

function fallbackSequence(loop: LoopDefinition): PrimarySequence {
  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const visited = new Map<string, number>();
  const states: LoopState[] = [];
  const links: SequenceLink[] = [];
  const chosenTransitionIds = new Set<string>();
  let loopBack: LoopBack | null = null;
  let currentId: string | undefined = loop.startState;

  while (currentId && states.length <= loop.states.length) {
    const state = stateMap.get(currentId);
    if (!state || visited.has(currentId)) break;

    visited.set(currentId, states.length);
    states.push(state);

    const transition = orderedTransitions(state)[0];
    if (!transition) break;

    chosenTransitionIds.add(transition.id);
    const targetIndex = visited.get(transition.to);
    if (targetIndex !== undefined) {
      loopBack = {
        sourceId: state.id,
        targetId: transition.to,
        transition,
        targetIndex,
      };
      break;
    }

    links.push({
      sourceId: state.id,
      targetId: transition.to,
      transition,
    });
    currentId = transition.to;
  }

  return { states, links, loopBack, chosenTransitionIds };
}

export function primarySequence(loop: LoopDefinition): PrimarySequence {
  const trace = findCycleTrace(loop);
  if (!trace) return fallbackSequence(loop);

  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const states = trace.stateIds
    .map((id) => stateMap.get(id))
    .filter(Boolean) as LoopState[];
  const chosenTransitionIds = new Set(
    trace.transitions.map((transition) => transition.id),
  );
  const links = trace.transitions.slice(0, -1).map((transition, index) => ({
    sourceId: states[index].id,
    targetId: transition.to,
    transition,
  }));
  const transition = trace.transitions.at(-1)!;
  const source = states.at(-1)!;

  return {
    states,
    links,
    loopBack: {
      sourceId: source.id,
      targetId: transition.to,
      transition,
      targetIndex: trace.targetIndex,
    },
    chosenTransitionIds,
  };
}
