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

function findCycleTrace(loop: LoopDefinition): CycleTrace | null {
  const stateMap = new Map(loop.states.map((state) => [state.id, state]));
  const exhausted = new Set<string>();
  const active = new Map<string, number>();
  const stateIds: string[] = [];
  const transitions: LoopTransition[] = [];

  function visit(id: string): CycleTrace | null {
    const state = stateMap.get(id);
    if (!state) return null;

    active.set(id, stateIds.length);
    stateIds.push(id);

    for (const transition of orderedTransitions(state)) {
      if (!stateMap.has(transition.to)) continue;

      const targetIndex = active.get(transition.to);
      if (targetIndex !== undefined) {
        return {
          stateIds: [...stateIds],
          transitions: [...transitions, transition],
          targetIndex,
        };
      }

      if (exhausted.has(transition.to)) continue;
      transitions.push(transition);
      const trace = visit(transition.to);
      if (trace) return trace;
      transitions.pop();
    }

    stateIds.pop();
    active.delete(id);
    exhausted.add(id);
    return null;
  }

  if (!stateMap.has(loop.startState)) return null;
  return visit(loop.startState);
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
