import { EpisodeCase, PolicyCard } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";

export interface PolicyUpdateDecision {
  decision: "merge" | "create_new" | "split_existing" | "unassigned";
  reason: string;
  targetPolicyCardId?: string;
}

interface DecidePolicyUpdateResult {
  decision: PolicyUpdateDecision["decision"];
  reason: string;
  targetPolicyCardId?: string;
}

export const decidePolicyCardUpdate = async (
  llm: JsonGeneratingClient,
  episode: EpisodeCase,
  existingCards: PolicyCard[],
): Promise<PolicyUpdateDecision> => {
  if (existingCards.length === 0) {
    return {
      decision: "create_new",
      reason: "No existing policy cards are available for this bot.",
    };
  }

  const parsed = await llm.generateJson<DecidePolicyUpdateResult>(
    [
      "あなたは conversation memory policy update judge です。",
      "Episode と既存 PolicyCard 群を見て、merge/create_new/split_existing/unassigned を判断してください。",
      "JSON のみを返してください。",
    ].join(" "),
    JSON.stringify({
      episode,
      existingPolicyCards: existingCards,
    }),
  );

  const decision = normalizeDecision(parsed.decision);
  const reason = normalizeText(parsed.reason) || "No reason provided";
  const targetPolicyCardId =
    parsed.targetPolicyCardId &&
    existingCards.some((card) => card.id === parsed.targetPolicyCardId)
      ? parsed.targetPolicyCardId
      : undefined;

  return {
    decision,
    reason,
    targetPolicyCardId,
  };
};

const normalizeDecision = (
  value: PolicyUpdateDecision["decision"] | string | undefined,
): PolicyUpdateDecision["decision"] => {
  if (
    value === "merge" ||
    value === "create_new" ||
    value === "split_existing" ||
    value === "unassigned"
  ) {
    return value;
  }
  return "unassigned";
};

const normalizeText = (value: string | undefined): string => value?.trim() ?? "";
