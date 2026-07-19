export type StateKind =
  | "observe"
  | "decide"
  | "act"
  | "evaluate"
  | "update"
  | "interrupt"
  | "terminal";

export type TransitionKind =
  | "normal"
  | "continue"
  | "interrupt"
  | "complete";

export interface LoopTransition {
  id: string;
  to: string;
  when: string;
  kind: TransitionKind;
}

export interface LoopState {
  id: string;
  name: string;
  kind: StateKind;
  summary: string;
  reads: string[];
  instruction: string;
  writes: string[];
  completion: string;
  transitions: LoopTransition[];
}

export interface LoopArtifact {
  id: string;
  name: string;
  description: string;
}

export interface LoopBoundary {
  id: string;
  name: string;
  description: string;
  kind: "interrupt" | "complete" | "budget";
}

export interface LoopDefinition {
  schemaVersion: 1;
  revision: number;
  name: string;
  objective: string;
  status: "draft" | "confirmed";
  startState: string;
  artifacts: LoopArtifact[];
  boundaries: LoopBoundary[];
  states: LoopState[];
}

export type ValidationSeverity = "error" | "warning" | "pass";

export interface ValidationFinding {
  id: string;
  severity: ValidationSeverity;
  title: string;
  detail: string;
  elementId?: string;
}
