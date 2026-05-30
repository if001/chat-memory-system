import { EpisodeCase, PolicyCard } from "../../domain/types";
import { OllamaClient } from "../../infrastructure/ollama/client";

interface BuildPolicyResult {
  title: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior: string;
  distinctionNotes: string;
  confidence: PolicyCard["confidence"];
}

export const buildPolicyCardFromEpisodes = async (
  llm: OllamaClient,
  botId: string,
  episodes: EpisodeCase[],
): Promise<PolicyCard | null> => {
  if (episodes.length === 0) {
    return null;
  }
  if (hasStrongSplitSignal(episodes)) {
    return null;
  }
  const systemPrompt = [
    "You are a policy card builder.",
    "Synthesize one practical policy card from episode cases.",
    "Return JSON only.",
  ].join(" ");
  const userPrompt = JSON.stringify({
    instruction:
      "Create title, appliesWhen, recommendedBehavior, avoidBehavior, distinctionNotes, confidence.",
    episodes,
  });
  const parsed = await llm.generateJson<BuildPolicyResult>(systemPrompt, userPrompt);
  return {
    id: buildPolicyCardId(botId, episodes),
    botId,
    title: requireText(parsed.title, "title"),
    appliesWhen: requireText(parsed.appliesWhen, "appliesWhen"),
    recommendedBehavior: requireText(parsed.recommendedBehavior, "recommendedBehavior"),
    avoidBehavior: normalizeOptionalText(parsed.avoidBehavior),
    distinctionNotes: normalizeOptionalText(parsed.distinctionNotes),
    confidence: normalizeConfidence(parsed.confidence),
    evidenceEpisodeIds: episodes.map((e) => e.id),
    lastUpdatedIso: new Date().toISOString(),
  };
};

const normalizeConfidence = (
  value: PolicyCard["confidence"] | string,
): PolicyCard["confidence"] => {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
};

const hasStrongSplitSignal = (episodes: EpisodeCase[]): boolean => {
  return episodes.some((episode) =>
    episode.feedbackSignals.some(
      (signal) => signal.type === "distinction_request" && signal.updateHint === "split" && signal.strength === "high",
    ),
  );
};

const requireText = (value: string, fieldName: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`buildPolicyCardFromEpisodes returned empty ${fieldName}`);
  }
  return normalized;
};

const normalizeOptionalText = (value: string): string => value?.trim() ?? "";

const buildPolicyCardId = (botId: string, episodes: EpisodeCase[]): string => {
  const episodeKey = episodes
    .map((episode) => episode.id)
    .sort()
    .join("__");
  return `pc_${sanitizeIdPart(botId)}_${sanitizeIdPart(episodeKey)}`;
};

const sanitizeIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_");
