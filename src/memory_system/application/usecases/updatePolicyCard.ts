import { buildPolicyCardId } from "../../domain/identifiers";
import {
  EpisodeCase,
  PolicyCard,
  PolicyHypothesis,
} from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";
import { episodeForLlm, policyCardsForLlm } from "./llmPayloads";

interface UpdateDecision {
  decision?: "merge" | "create";
  targetPolicyCardId?: string;
}

export const updatePolicyCardFromEpisode = async (input: {
  llm: JsonGeneratingClient;
  botId: string;
  episode: EpisodeCase;
  existingCards: PolicyCard[];
  episodesByCardId: Map<string, EpisodeCase[]>;
  buildHypothesis(episodes: EpisodeCase[]): Promise<PolicyHypothesis>;
  now?: () => Date;
}): Promise<PolicyCard> => {
  const target = await selectMergeTarget(input);
  const evidence = target
    ? [...(input.episodesByCardId.get(target.id) ?? []), input.episode]
    : [input.episode];
  const hypothesis = await input.buildHypothesis(evidence);
  const nowIso = (input.now ?? (() => new Date()))().toISOString();
  return {
    id: target?.id ?? buildPolicyCardId(input.botId, hypothesis.episodeIds),
    botId: input.botId,
    appliesWhen: hypothesis.appliesWhen,
    recommendedBehavior: hypothesis.recommendedBehavior,
    ...(hypothesis.avoidBehavior
      ? { avoidBehavior: hypothesis.avoidBehavior }
      : {}),
    episodeIds: [...new Set([...(target?.episodeIds ?? []), ...hypothesis.episodeIds])],
    createdAtIso: target?.createdAtIso ?? nowIso,
    lastUpdatedIso: nowIso,
  };
};

const selectMergeTarget = async (input: {
  llm: JsonGeneratingClient;
  episode: EpisodeCase;
  existingCards: PolicyCard[];
}): Promise<PolicyCard | null> => {
  if (input.existingCards.length === 0) {
    return null;
  }
  const decision = await input.llm.generateJson<UpdateDecision>(
    [
      "あなたは procedural memory の更新判定器です。",
      "新しいEpisodeと同じ適用条件かつ同じ推奨行動のPolicyCardだけをmergeしてください。",
      "推奨行動が異なる場合は、状況が似ていてもcreateを選んでください。",
      "JSONのみを返してください。",
    ].join(" "),
    JSON.stringify({
      instruction:
        "decisionをmergeまたはcreateで返し、mergeの場合だけtargetPolicyCardIdを返してください。",
      episode: episodeForLlm(input.episode),
      policyCards: policyCardsForLlm(input.existingCards),
    }),
  );
  if (decision.decision !== "merge" || !decision.targetPolicyCardId) {
    return null;
  }
  return (
    input.existingCards.find(
      (card) => card.id === decision.targetPolicyCardId,
    ) ?? null
  );
};
