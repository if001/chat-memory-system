import { EpisodeCase, PolicyHypothesis } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";
import { episodesForLlm } from "./llmPayloads";

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
      "あなたは、ユーザーと対話するAgentの行動方針を抽出するPolicy分析器です。",
      "入力として、同一のPolicyにまとめられる可能性がある複数のEpisodeが与えられます。",
      "各Episodeはstate, action, outcomeを持ちます。",
      "state: そのときのユーザー要求、会話文脈、対象領域、目的",
      "action: Agentが実際に行った応答戦略や情報取得戦略",
      "outcome: actionの後に生じた、ユーザー理解や会話状態の変化",
      "Policyは、具体的な回答内容の要約ではありません。",
      "Policyは次の形式の抽象的な行動方針です。",
      "## state",
      "stateには、actionを選択するために必要な条件だけを含めてください。",
      "固有名詞や特定の製品名、書籍名、技術名は、それ自体が行動選択に不可欠でない限り一般化してください。",
      "単なる話題の共通点ではなく、actionが有効になる理由となる共通条件を抽出してください。",
      "## action",
      "Agentが将来再利用できる具体的な応答戦略を記述してください。特定Episodeで回答した内容ではなく、回答を生成する手順や方針です。",
      "## outcome",
      "actionによって目指すユーザーまたは会話の変化を記述してください。",
      "",
      "JSON のみを返してください。",
    ].join(" "),
    JSON.stringify({
      instruction:
        "state, action, outcome を返してください。Episode の共通構造を抽象化し、手順として使える粒度にしてください。",
      episodes: episodesForLlm(episodes),
    }),
  );

  const state = requireText(parsed.state, "state");
  const action = requireText(parsed.action, "action");
  const outcome = requireText(parsed.outcome, "outcome");

  console.log(
    "[buildPolicyHypothesisFromEpisodes]: base episode",
    episodesForLlm(episodes),
  );
  console.log("[buildPolicyHypothesisFromEpisodes]: hypothesis", {
    state,
    action,
    outcome,
  });

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
