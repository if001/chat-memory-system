import { EpisodeCase, PolicyCard } from "../../domain/types";

export const mergePolicyCardUpdate = (
  existing: PolicyCard,
  merged: Pick<
    PolicyCard,
    | "title"
    | "appliesWhen"
    | "recommendedBehavior"
    | "avoidBehavior"
    | "distinctionNotes"
  >,
  episode: EpisodeCase,
): PolicyCard => {
  return {
    id: existing.id,
    botId: existing.botId,
    title: merged.title,
    appliesWhen: merged.appliesWhen,
    recommendedBehavior: merged.recommendedBehavior,
    avoidBehavior: merged.avoidBehavior,
    distinctionNotes: merged.distinctionNotes,
    confidence: adjustConfidence(existing.confidence, episode),
    evidenceEpisodeIds: uniqueIds([...existing.evidenceEpisodeIds, episode.id]),
    lastUpdatedIso: new Date().toISOString(),
  };
};

const uniqueIds = (values: string[]): string[] => [...new Set(values)];

const adjustConfidence = (
  existing: PolicyCard["confidence"],
  episode: EpisodeCase,
): PolicyCard["confidence"] => {
  let score = toScore(existing);

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
