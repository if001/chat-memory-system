import { EpisodeCase, PolicyCard, PolicyUpdateDecision } from "../../domain/types";

export const mergePolicyCardUpdate = (
  existing: PolicyCard,
  updated: NonNullable<PolicyUpdateDecision["updatedPolicyCard"]>,
  episode: EpisodeCase,
): PolicyCard => {
  const distinctionNotes = mergeDistinctText([
    existing.distinctionNotes,
    updated.distinctionNotes,
    buildEpisodeDistinctionNote(episode),
  ]);

  return {
    id: existing.id,
    botId: existing.botId,
    title: updated.title,
    appliesWhen: updated.appliesWhen,
    recommendedBehavior: updated.recommendedBehavior,
    avoidBehavior: mergeDistinctText([existing.avoidBehavior, updated.avoidBehavior]),
    distinctionNotes,
    confidence: adjustConfidence(existing.confidence, updated.confidence, episode),
    evidenceEpisodeIds: uniqueIds([...existing.evidenceEpisodeIds, episode.id]),
    lastUpdatedIso: new Date().toISOString(),
  };
};

const buildEpisodeDistinctionNote = (episode: EpisodeCase): string => {
  const distinctionSignals = episode.feedbackSignals.filter(
    (signal) => signal.type === "distinction_request" || signal.target === "distinction",
  );
  if (distinctionSignals.length === 0) {
    return "";
  }
  return distinctionSignals.map((signal) => signal.text.trim()).join(" ");
};

const mergeDistinctText = (values: string[]): string => {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(normalized)].join("\n");
};

const uniqueIds = (values: string[]): string[] => [...new Set(values)];

const adjustConfidence = (
  existing: PolicyCard["confidence"],
  updated: PolicyCard["confidence"],
  episode: EpisodeCase,
): PolicyCard["confidence"] => {
  let score = Math.max(toScore(existing), toScore(updated));

  if (
    episode.outcomeAssessment.overall === "positive" &&
    episode.outcomeAssessment.score >= 1
  ) {
    score += 1;
  }
  if (
    episode.outcomeAssessment.overall === "negative" ||
    episode.outcomeAssessment.score < 0 ||
    episode.outcomeAssessment.updateHint === "weaken" ||
    episode.outcomeAssessment.updateHint === "avoid"
  ) {
    score -= 1;
  }

  for (const signal of episode.feedbackSignals) {
    if (
      signal.type === "explicit_positive" ||
      signal.type === "achievement" ||
      signal.type === "continuation"
    ) {
      score += 1;
    }
    if (
      signal.type === "explicit_negative" ||
      signal.type === "confusion" ||
      signal.type === "friction"
    ) {
      score -= 1;
    }
  }

  return fromScore(score);
};

const toScore = (value: PolicyCard["confidence"]): number => {
  if (value === "high") {
    return 2;
  }
  if (value === "medium") {
    return 1;
  }
  return 0;
};

const fromScore = (value: number): PolicyCard["confidence"] => {
  if (value >= 2) {
    return "high";
  }
  if (value <= 0) {
    return "low";
  }
  return "medium";
};
