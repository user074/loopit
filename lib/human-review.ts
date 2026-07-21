export interface HumanReviewRequest {
  key: string;
  loopRevision: number;
  context: string;
  question: string;
  recommendation: string;
  recommendedDecision: string | null;
  whyHuman: string;
  options: string[];
}

function reportField(section: string, label: string) {
  const match = section.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+)`,
      "i",
    ),
  );
  return match?.[1]?.trim() ?? "";
}

export function lastQuestion(text: string) {
  const end = text.lastIndexOf("?");
  if (end < 0) return "";
  const start = Math.max(
    text.lastIndexOf("\n", end - 1),
    text.lastIndexOf(". ", end - 1),
  );
  return text.slice(start + 1, end + 1).trim();
}

function questionOptions(question: string) {
  const parts = question
    .replace(/\?$/, "")
    .split(/,?\s+or\s+/i)
    .map((part, index) =>
      part
        .replace(index === 0 ? /^should\s+/i : /^may\s+/i, "")
        .trim(),
    )
    .filter((part) => part.length > 5);
  return parts.length === 2 ? parts : [];
}

export function extractHumanReview(
  report: string,
  _agentMessage: string | null,
  loopRevision: number,
): HumanReviewRequest | null {
  const section =
    report.match(
      /(?:^|\n)###\s+Ask human\s*\n([\s\S]*?)(?=\n#{2,3}\s|$)/i,
    )?.[1] ?? "";
  const structuredQuestion = reportField(section, "Question");
  const question = structuredQuestion;
  if (!question) return null;

  const context = reportField(section, "Context");
  const recommendation = reportField(section, "Recommendation");
  const whyHuman = reportField(section, "Why human");
  const ownershipText = `${question} ${context} ${recommendation} ${whyHuman}`;
  if (
    /parser|parsing|markdown|schema|required field|allowed value|enum|state kind|transition kind|structural trace|validator/i.test(
      ownershipText,
    )
  ) {
    return null;
  }
  if (
    !/intent|permission|authority|private|sensitive|credential|cost|budget|risk|policy|threshold|external action|user['’]s name/i.test(
      whyHuman,
    )
  ) {
    return null;
  }
  const optionsBlock = section.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?Options(?:\*\*)?\s*:\s*\n([\s\S]*?)$/i,
  )?.[1];
  const options = optionsBlock
    ? optionsBlock
        .split("\n")
        .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
        .filter(Boolean)
    : questionOptions(question);
  const recommendedDecision = options[0] ?? (recommendation || null);
  const visibleRecommendation =
    recommendation ||
    (options.length
      ? `Use “${options[0]}” as the safe default until you explicitly choose broader authority.`
      : "Confirm or correct the proposed direction so the agent can record it and continue.");

  return {
    key: `${loopRevision}-${question}`,
    loopRevision,
    context:
      context ||
      `The loop reached a decision that it cannot safely derive from project evidence. ${whyHuman}`,
    question,
    recommendation: visibleRecommendation,
    recommendedDecision,
    whyHuman:
      whyHuman ||
      "This requires your intent, permission, private knowledge, cost choice, or risk tolerance; the agent should not invent it.",
    options,
  };
}
