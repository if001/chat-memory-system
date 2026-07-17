import { EpisodeCase, PolicyCard } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";

interface BuildMergedPolicyResult {
  title: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior: string;
  distinctionNotes: string;
}

export const buildMergedPolicyCard = async (
  llm: JsonGeneratingClient,
  existingCard: PolicyCard,
  episode: EpisodeCase,
): Promise<BuildMergedPolicyResult> => {
  console.log("[buildMergedPolicyCard]: update policy card");
  const parsed = await llm.generateJson<BuildMergedPolicyResult>(
    [
      "あなたは policy card editor です。",
      "既存 policy card と新しい episode を読んで、policy card 全体を短く実用的に書き直してください。",
      "文字列を足し合わせるのではなく、冗長さを避けて圧縮された最新版を作ってください。",
      "JSON のみを返してください。",
    ].join(" "),
    JSON.stringify({
      instruction: [
        "title, appliesWhen, recommendedBehavior, avoidBehavior, distinctionNotes を返してください。",
        "既存 card の意図を保ちつつ、今回の episode を反映してください。",
        "avoidBehavior と distinctionNotes は必要最小限に保ってください。",
        "自然な書き直しを行い、単純な追記や重複を避けてください。",
      ].join(" "),
      existingPolicyCard: existingCard,
      episode,
    }),
  );

  return {
    title: requireText(parsed.title, "title"),
    appliesWhen: requireText(parsed.appliesWhen, "appliesWhen"),
    recommendedBehavior: requireText(
      parsed.recommendedBehavior,
      "recommendedBehavior",
    ),
    avoidBehavior: normalizeOptionalText(parsed.avoidBehavior),
    distinctionNotes: normalizeOptionalText(parsed.distinctionNotes),
  };
};

const requireText = (value: string, fieldName: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`buildMergedPolicyCard returned empty ${fieldName}`);
  }
  return normalized;
};

const normalizeOptionalText = (value: string): string => value?.trim() ?? "";
