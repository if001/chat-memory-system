import { EpisodeCase, PolicyCard, PolicyHypothesis } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";
import { buildPolicyHypothesisFromEpisodes } from "./buildPolicyCard";

export const buildMergedPolicyHypothesis = async (
  llm: JsonGeneratingClient,
  existingCard: PolicyCard,
  episodes: EpisodeCase[],
): Promise<PolicyHypothesis> => {
  console.log("[buildMergedPolicyHypothesis]: update policy card");
  return buildPolicyHypothesisFromEpisodes(llm, [
    ...episodes,
    {
      id: `card-${existingCard.id}`,
      botId: existingCard.botId,
      threadId: existingCard.id,
      state: existingCard.state,
      action: existingCard.action,
      outcome: existingCard.outcome,
      stateEmbeddingVector: existingCard.stateEmbeddingVector,
      actionEmbeddingVector: existingCard.actionEmbeddingVector,
      outcomeEmbeddingVector: existingCard.outcomeEmbeddingVector,
      createdAtIso: existingCard.lastUpdatedIso,
    },
  ]);
};
