import { EpisodeCase, PolicyCard, PolicySplitCandidate } from "../../domain/types";

export const applyResolvedSplitCandidate = (
  card: PolicyCard,
  episode: EpisodeCase,
  candidate: PolicySplitCandidate,
): PolicyCard => {
  const distinctionNote = buildDistinctionNote(card.distinctionNotes, candidate.reason);
  return {
    ...card,
    distinctionNotes: distinctionNote,
    confidence: lowerConfidence(card.confidence),
    evidenceEpisodeIds: card.evidenceEpisodeIds.filter((id) => id !== episode.id),
    lastUpdatedIso: new Date().toISOString(),
  };
};

const buildDistinctionNote = (
  currentNotes: string,
  reason: string,
): string => {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return currentNotes;
  }
  if (currentNotes.includes(normalizedReason)) {
    return currentNotes;
  }
  if (!currentNotes.trim()) {
    return `Split boundary: ${normalizedReason}`;
  }
  return `${currentNotes}\nSplit boundary: ${normalizedReason}`;
};

const lowerConfidence = (confidence: PolicyCard["confidence"]): PolicyCard["confidence"] => {
  if (confidence === "high") {
    return "medium";
  }
  return "low";
};
