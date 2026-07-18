import { EpisodeCase, PolicyHypothesis } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";

interface BuildPolicyHypothesisResult {
  state: string;
  action: string;
  outcome: string;
}

export const buildPolicyHypothesisFromEpisodes = async (
  llm: JsonGeneratingClient,
  episodes: EpisodeCase[],
  embedText?: (text: string) => Promise<number[]>,
): Promise<PolicyHypothesis> => {
  if (episodes.length === 0) {
    throw new Error("buildPolicyHypothesisFromEpisodes requires episodes");
  }
  console.log("[buildPolicyHypothesisFromEpisodes]: call llm");
  const parsed = await llm.generateJson<BuildPolicyHypothesisResult>(
    [
      "あなたは policy hypothesis builder です。",
      "Episode 群から、抽象的な state/action/outcome を 1 つ抽出してください。",
      "JSON のみを返してください。",
    ].join(" "),
    JSON.stringify({
      instruction:
        "state, action, outcome を返してください。Episode の共通構造を抽象化し、手順として使える粒度にしてください。",
      episodes,
    }),
  );

  const state = requireText(parsed.state, "state");
  const action = requireText(parsed.action, "action");
  const outcome = requireText(parsed.outcome, "outcome");
  const [stateEmbeddingVector, actionEmbeddingVector, outcomeEmbeddingVector] =
    embedText
      ? await Promise.all([
          embedText(state),
          embedText(action),
          embedText(outcome),
        ])
      : [[], [], []];

  return {
    state,
    action,
    outcome,
    stateEmbeddingVector,
    actionEmbeddingVector,
    outcomeEmbeddingVector,
    relatedEpisodeIds: episodes.map((episode) => episode.id),
  };
};

const requireText = (value: string, fieldName: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      `buildPolicyHypothesisFromEpisodes returned empty ${fieldName}`,
    );
  }
  return normalized;
};
