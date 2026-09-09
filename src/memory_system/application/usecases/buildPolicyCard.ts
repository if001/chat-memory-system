import { EpisodeCase, PolicyHypothesis } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";
import { episodesForLlm } from "./llmPayloads";

interface BuildPolicyHypothesisResult {
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
}

export const buildPolicyHypothesisFromEpisodes = async (
  llm: JsonGeneratingClient,
  episodes: EpisodeCase[],
): Promise<PolicyHypothesis> => {
  if (episodes.length === 0) {
    throw new Error("buildPolicyHypothesisFromEpisodes requires episodes");
  }
  const parsed = await llm.generateJson<BuildPolicyHypothesisResult>(
    [
      "あなたは、ユーザーと対話するAgentの行動方針を抽出するPolicy分析器です。",
      "入力として、同一のPolicyにまとめられる可能性がある複数のEpisodeが与えられます。",
      "各Episodeはstate, action, outcomeを持ちます。",
      "state: そのときのユーザー要求、会話文脈、対象領域、目的",
      "action: Agentが実際に行った応答戦略や情報取得戦略",
      "outcome: actionの後に生じた、ユーザー理解や会話状態の変化",
      "Policyは、具体的な回答内容の要約ではありません。",
      "Policyは適用条件、推奨行動、必要なら回避行動だけを持つ抽象的な行動方針です。",
      "## appliesWhen",
      "recommendedBehaviorを選ぶために必要な条件だけを含めてください。",
      "固有名詞や特定の製品名、書籍名、技術名は、それ自体が行動選択に不可欠でない限り一般化してください。",
      "単なる話題の共通点ではなく、actionが有効になる理由となる共通条件を抽出してください。",
      "## recommendedBehavior",
      "Agentが将来再利用できる具体的な応答戦略を記述してください。特定Episodeで回答した内容ではなく、回答を生成する手順や方針です。",
      "## avoidBehavior",
      "Episodeに失敗や否定的反応がある場合だけ、避けるべき応答を記述してください。",
      "",
      "JSON のみを返してください。",
    ].join(" "),
    JSON.stringify({
      instruction:
        "appliesWhen, recommendedBehavior, avoidBehavior を返してください。Episode の共通構造を抽象化し、手順として使える粒度にしてください。",
      episodes: episodesForLlm(episodes),
    }),
  );

  const appliesWhen = requireText(parsed.appliesWhen, "appliesWhen");
  const recommendedBehavior = requireText(
    parsed.recommendedBehavior,
    "recommendedBehavior",
  );
  const avoidBehavior = parsed.avoidBehavior?.trim();

  return {
    appliesWhen,
    recommendedBehavior,
    ...(avoidBehavior ? { avoidBehavior } : {}),
    episodeIds: episodes.map((episode) => episode.id),
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
