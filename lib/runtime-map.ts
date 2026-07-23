export type RuntimeRegionCondition =
  | "active"
  | "supported"
  | "review"
  | "ready"
  | "waiting"
  | "uncertain"
  | "failed";

export type RuntimeRegionHighlightTone =
  | "active"
  | "complete"
  | "review"
  | "ready"
  | "waiting"
  | "uncertain"
  | "failed";

interface RuntimeMapStateItem {
  id: string;
  kind: "artifact" | "belief" | "failure" | "uncertainty";
  name: string;
  status: string;
  summary: string;
  evidence: string[];
}

interface RuntimeMapFrontierItem {
  id: string;
  title: string;
  status: "ready" | "active" | "waiting" | "retired";
  priority: number;
  objectiveLink: string;
  causedBy: string;
  retirementEvidence: string;
}

export interface RuntimeMapState {
  items: RuntimeMapStateItem[];
  frontier: RuntimeMapFrontierItem[];
  activeAssignment: {
    frontierId: string;
    title: string;
  } | null;
}

export interface RuntimeMapLedgerEntry {
  number: number;
  title: string;
  assignmentId: string;
  progress: "advanced" | "learned" | "neutral" | "regressed";
  completed: string;
  next: string;
  reason: string;
  stateChanges: string[];
  frontierChanges: string[];
}

export interface RuntimeMapAnchor {
  id: string;
  title: string;
  summary?: string;
  objective?: string;
  doneWhen?: string;
}

export interface RuntimeMapOptions {
  anchors?: RuntimeMapAnchor[];
  ledger?: RuntimeMapLedgerEntry[];
  reviewedThrough?: number;
  activeRegionId?: string | null;
  maximumRegions?: number;
}

export interface RuntimeRegionHighlight {
  id: string;
  tone: RuntimeRegionHighlightTone;
  label: string;
}

export interface RuntimeRegionMoment {
  label: string;
  detail: string;
  tone: RuntimeRegionHighlightTone;
}

export interface RuntimeMapRegion {
  id: string;
  label: string;
  condition: RuntimeRegionCondition;
  priority: number;
  summary: string;
  objective: string;
  doneWhen: string;
  evidenceCount: number;
  itemCount: number;
  memberIds: string[];
  sourceStatus: RuntimeMapFrontierItem["status"] | "state";
  progress: number;
  progressLabel: string;
  completedCount: number;
  totalCount: number;
  reviewCount: number;
  issueCount: number;
  uncertaintyCount: number;
  highlights: RuntimeRegionHighlight[];
  past: RuntimeRegionMoment | null;
  present: RuntimeRegionMoment | null;
  future: RuntimeRegionMoment | null;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function runtimeRegionLabel(value: string) {
  const source = clean(value);
  const quoted = source.match(/^`([^`]+)`\s*[—-]/)?.[1] ?? source;
  const withoutStatus = quoted.split(/\s+·\s+/)[0];
  const withoutIdentifier = withoutStatus.replace(
    /^(?:[A-Z]{1,4}\d+(?:\.\d+)*)\s+(?:[-:]\s*)?/,
    "",
  );
  const label = clean(withoutIdentifier);
  return label.length > 58 ? `${label.slice(0, 57).trim()}…` : label;
}

function detail(value: string) {
  return clean(value).match(/[—-]\s+(.+)$/)?.[1] ?? clean(value);
}

function tokens(value: string) {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function overlap(left: Set<string>, right: Set<string>) {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

function bestAnchorIndex(value: string, anchors: RuntimeMapAnchor[]) {
  const valueTokens = tokens(value);
  let bestIndex = -1;
  let bestScore = 0;
  for (const [index, anchor] of anchors.entries()) {
    const score = overlap(valueTokens, tokens(runtimeRegionLabel(anchor.title)));
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

function isResolvedStatus(status: string) {
  return /support|verify|complete|implemented|passed|accepted|resolved|working/i.test(
    status,
  );
}

function isNotStarted(item: RuntimeMapStateItem) {
  return /not started|not implemented|missing|does not exist|no .+ exists/i.test(
    `${item.name} ${item.summary}`,
  );
}

function stateTone(item: RuntimeMapStateItem): RuntimeRegionHighlightTone {
  if (
    item.kind === "failure" ||
    /fail|regress|broken|blocked/i.test(item.status)
  ) {
    return "failed";
  }
  if (
    item.kind === "uncertainty" ||
    /uncertain|mixed|weak/i.test(item.status) ||
    (/unverified/i.test(item.status) && !isNotStarted(item))
  ) {
    return "uncertain";
  }
  return isResolvedStatus(item.status) ? "complete" : "ready";
}

function uniqueHighlights(highlights: RuntimeRegionHighlight[]) {
  const seen = new Set<string>();
  return highlights
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (!item.label || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function conditionForArea({
  active,
  reviewCount,
  issueCount,
  uncertaintyCount,
  waitingCount,
  readyCount,
  progress,
}: {
  active: boolean;
  reviewCount: number;
  issueCount: number;
  uncertaintyCount: number;
  waitingCount: number;
  readyCount: number;
  progress: number;
}): RuntimeRegionCondition {
  if (active) return "active";
  if (issueCount > 0) return "failed";
  if (reviewCount > 0) return "review";
  if (waitingCount > 0 && readyCount === 0) return "waiting";
  if (uncertaintyCount > 0) return "uncertain";
  if (progress === 100) return "supported";
  return "ready";
}

function sourceStatusFor(frontier: RuntimeMapFrontierItem[]) {
  return (
    frontier.find((item) => item.status === "active")?.status ??
    frontier.find((item) => item.status === "ready")?.status ??
    frontier.find((item) => item.status === "waiting")?.status ??
    frontier.find((item) => item.status === "retired")?.status ??
    "state"
  );
}

function areaRegion({
  anchor,
  anchorIndex,
  state,
  ledger,
  reviewedThrough,
  frontierAssignments,
  stateAssignments,
  ledgerAssignments,
  activeRegionId,
}: {
  anchor: RuntimeMapAnchor;
  anchorIndex: number;
  state: RuntimeMapState;
  ledger: RuntimeMapLedgerEntry[];
  reviewedThrough: number;
  frontierAssignments: number[];
  stateAssignments: number[];
  ledgerAssignments: number[];
  activeRegionId: string | null;
}): RuntimeMapRegion {
  const relatedFrontier = state.frontier.filter(
    (_, index) => frontierAssignments[index] === anchorIndex,
  );
  const relatedItems = state.items.filter(
    (_, index) => stateAssignments[index] === anchorIndex,
  );
  const relatedLedger = ledger.filter(
    (_, index) => ledgerAssignments[index] === anchorIndex,
  );
  const memberIds = Array.from(
    new Set([
      anchor.id,
      ...relatedFrontier.map((item) => item.id),
      ...relatedItems.map((item) => item.id),
    ]),
  );
  const active =
    memberIds.includes(activeRegionId ?? "") ||
    relatedFrontier.some((item) => item.status === "active") ||
    relatedFrontier.some(
      (item) => item.id === state.activeAssignment?.frontierId,
    );
  const finishedLedger = relatedLedger.filter((entry) =>
    ["advanced", "learned"].includes(entry.progress),
  );
  const retiredCount = relatedFrontier.filter(
    (item) =>
      item.status === "retired" &&
      !finishedLedger.some(
        (entry) =>
          runtimeRegionLabel(entry.title).toLowerCase() ===
          runtimeRegionLabel(item.title).toLowerCase(),
      ),
  ).length;
  const openFrontier = relatedFrontier.filter((item) =>
    ["ready", "active", "waiting"].includes(item.status),
  );
  const completedCount = finishedLedger.length + retiredCount;
  const openCount =
    openFrontier.length || completedCount > 0 ? openFrontier.length : 1;
  const totalCount = completedCount + openCount;
  const progress =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const reviewEntries = relatedLedger.filter(
    (entry) => entry.number > reviewedThrough,
  );
  const failedItems = relatedItems.filter(
    (item) => stateTone(item) === "failed",
  );
  const uncertaintyItems = relatedItems.filter(
    (item) => stateTone(item) === "uncertain",
  );
  const regressedEntries = relatedLedger.filter(
    (entry) => entry.progress === "regressed",
  );
  const issueCount = failedItems.length + regressedEntries.length;
  const uncertaintyCount = uncertaintyItems.length;
  const waitingCount = relatedFrontier.filter(
    (item) => item.status === "waiting",
  ).length;
  const readyCount = relatedFrontier.filter(
    (item) => item.status === "ready",
  ).length;
  const latestLedger = relatedLedger.at(-1);
  const activeFrontier =
    relatedFrontier.find((item) => item.status === "active") ??
    relatedFrontier.find(
      (item) => item.id === state.activeAssignment?.frontierId,
    );
  const nextFrontier = [...relatedFrontier]
    .filter((item) => item.status === "ready")
    .sort((left, right) => right.priority - left.priority);
  const highlights = uniqueHighlights([
    ...(activeFrontier
      ? [
          {
            id: `active-${activeFrontier.id}`,
            tone: "active" as const,
            label: runtimeRegionLabel(activeFrontier.title),
          },
        ]
      : []),
    ...reviewEntries
      .slice(-1)
      .map((entry) => ({
        id: `review-${entry.number}`,
        tone: "review" as const,
        label: entry.completed,
      })),
    ...failedItems
      .slice(0, 1)
      .map((item) => ({
        id: `failure-${item.id}`,
        tone: "failed" as const,
        label: runtimeRegionLabel(item.name),
      })),
    ...regressedEntries
      .slice(-1)
      .map((entry) => ({
        id: `regressed-${entry.number}`,
        tone: "failed" as const,
        label: entry.completed,
      })),
    ...(latestLedger && !reviewEntries.includes(latestLedger)
      ? [
          {
            id: `complete-${latestLedger.number}`,
            tone: "complete" as const,
            label: latestLedger.completed,
          },
        ]
      : []),
    ...nextFrontier.slice(0, 3).map((item) => ({
      id: `ready-${item.id}`,
      tone: "ready" as const,
      label: runtimeRegionLabel(item.title),
    })),
    ...uncertaintyItems
      .slice(0, 1)
      .map((item) => ({
        id: `uncertain-${item.id}`,
        tone: "uncertain" as const,
        label: runtimeRegionLabel(item.name),
      })),
  ]);
  const evidenceCount = relatedItems.reduce(
    (total, item) => total + item.evidence.length,
    0,
  );
  const priority = Math.max(
    1,
    ...relatedFrontier.map((item) => item.priority),
  );
  const past = latestLedger
    ? {
        label: latestLedger.completed,
        detail: latestLedger.reason,
        tone:
          latestLedger.progress === "regressed"
            ? "failed" as const
            : latestLedger.number > reviewedThrough
              ? "review" as const
              : "complete" as const,
      }
    : null;
  const present = active
    ? {
        label:
          runtimeRegionLabel(
            activeFrontier?.title ??
              state.activeAssignment?.title ??
              anchor.title,
          ),
        detail: "A worker or supervisor is advancing this area now.",
        tone: "active" as const,
      }
    : null;
  const future = nextFrontier[0]
    ? {
        label: runtimeRegionLabel(nextFrontier[0].title),
        detail: nextFrontier[0].retirementEvidence,
        tone: "ready" as const,
      }
    : waitingCount > 0
      ? {
          label: runtimeRegionLabel(
            relatedFrontier.find((item) => item.status === "waiting")?.title ??
              anchor.title,
          ),
          detail:
            relatedFrontier.find((item) => item.status === "waiting")
              ?.retirementEvidence ??
            "This area is waiting for its declared boundary.",
          tone: "waiting" as const,
        }
      : null;
  return {
    id: anchor.id,
    label: runtimeRegionLabel(anchor.title),
    condition: conditionForArea({
      active,
      reviewCount: reviewEntries.length,
      issueCount,
      uncertaintyCount,
      waitingCount,
      readyCount,
      progress,
    }),
    priority,
    summary:
      latestLedger?.reason ??
      relatedItems[0]?.summary ??
      anchor.summary ??
      detail(anchor.title),
    objective:
      anchor.objective ??
      relatedFrontier[0]?.objectiveLink ??
      runtimeRegionLabel(anchor.title),
    doneWhen:
      anchor.doneWhen ??
      relatedFrontier[0]?.retirementEvidence ??
      "All currently tracked work is resolved with observable evidence.",
    evidenceCount,
    itemCount: relatedFrontier.length + relatedItems.length + relatedLedger.length,
    memberIds,
    sourceStatus: sourceStatusFor(relatedFrontier),
    progress,
    progressLabel: `${completedCount} of ${totalCount} tracked units resolved`,
    completedCount,
    totalCount,
    reviewCount: reviewEntries.length,
    issueCount,
    uncertaintyCount,
    highlights,
    past,
    present,
    future,
  };
}

function mergeRegions(regions: RuntimeMapRegion[]): RuntimeMapRegion {
  const completedCount = regions.reduce(
    (total, region) => total + region.completedCount,
    0,
  );
  const totalCount = regions.reduce(
    (total, region) => total + region.totalCount,
    0,
  );
  const progress =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const condition =
    regions.find((region) => region.condition === "active")?.condition ??
    regions.find((region) => region.condition === "failed")?.condition ??
    regions.find((region) => region.condition === "review")?.condition ??
    regions.find((region) => region.condition === "waiting")?.condition ??
    regions.find((region) => region.condition === "uncertain")?.condition ??
    (progress === 100 ? "supported" : "ready");
  return {
    id: "runtime-map-more",
    label: `${regions.length} more areas`,
    condition,
    priority: Math.max(...regions.map((region) => region.priority)),
    summary: regions.map((region) => region.label).join(" · "),
    objective: "Other objective-backed areas in the current project map.",
    doneWhen: "Open Next work to inspect every tracked area.",
    evidenceCount: regions.reduce(
      (total, region) => total + region.evidenceCount,
      0,
    ),
    itemCount: regions.reduce((total, region) => total + region.itemCount, 0),
    memberIds: regions.flatMap((region) => region.memberIds),
    sourceStatus: "state",
    progress,
    progressLabel: `${completedCount} of ${totalCount} tracked units resolved`,
    completedCount,
    totalCount,
    reviewCount: regions.reduce(
      (total, region) => total + region.reviewCount,
      0,
    ),
    issueCount: regions.reduce(
      (total, region) => total + region.issueCount,
      0,
    ),
    uncertaintyCount: regions.reduce(
      (total, region) => total + region.uncertaintyCount,
      0,
    ),
    highlights: uniqueHighlights(
      regions.flatMap((region) => region.highlights),
    ),
    past: regions.findLast((region) => region.past)?.past ?? null,
    present: regions.find((region) => region.present)?.present ?? null,
    future: regions.find((region) => region.future)?.future ?? null,
  };
}

export function buildRuntimeMap(
  state: RuntimeMapState | null,
  options: RuntimeMapOptions = {},
) {
  if (!state) return [];
  const ledger = options.ledger ?? [];
  const reviewedThrough = options.reviewedThrough ?? 0;
  const maximumRegions = Math.max(3, options.maximumRegions ?? 6);
  const anchors =
    options.anchors?.length
      ? options.anchors
      : state.frontier.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.causedBy,
          objective: item.objectiveLink,
          doneWhen: item.retirementEvidence,
        }));
  if (!anchors.length) {
    return state.items
      .filter((item) => !item.id.startsWith("foundation-"))
      .slice(0, maximumRegions)
      .map((item, index) =>
        areaRegion({
          anchor: {
            id: item.id,
            title: item.name,
            summary: item.summary,
          },
          anchorIndex: index,
          state,
          ledger,
          reviewedThrough,
          frontierAssignments: state.frontier.map(() => -1),
          stateAssignments: state.items.map((candidate) =>
            candidate.id === item.id ? index : -1,
          ),
          ledgerAssignments: ledger.map(() => -1),
          activeRegionId: options.activeRegionId ?? null,
        }),
      );
  }

  const frontierAssignments = state.frontier.map((item) => {
    const exactAnchor = anchors.findIndex((anchor) => anchor.id === item.id);
    return exactAnchor >= 0
      ? exactAnchor
      : bestAnchorIndex(`${item.title} ${item.causedBy}`, anchors);
  });
  const stateAssignments = state.items.map((item) =>
    item.id.startsWith("foundation-")
      ? -1
      : bestAnchorIndex(`${item.name} ${item.summary}`, anchors),
  );
  const ledgerAssignments = ledger.map((entry) => {
    const frontierIndex = state.frontier.findIndex(
      (item) => item.id === entry.assignmentId,
    );
    if (frontierIndex >= 0) return frontierAssignments[frontierIndex];
    return bestAnchorIndex(
      `${entry.title} ${entry.completed} ${entry.next} ${entry.stateChanges.join(" ")} ${entry.frontierChanges.join(" ")}`,
      anchors,
    );
  });
  const regions = anchors.map((anchor, anchorIndex) =>
    areaRegion({
      anchor,
      anchorIndex,
      state,
      ledger,
      reviewedThrough,
      frontierAssignments,
      stateAssignments,
      ledgerAssignments,
      activeRegionId: options.activeRegionId ?? null,
    }),
  );
  if (regions.length <= maximumRegions) return regions;
  return [
    ...regions.slice(0, maximumRegions - 1),
    mergeRegions(regions.slice(maximumRegions - 1)),
  ];
}
