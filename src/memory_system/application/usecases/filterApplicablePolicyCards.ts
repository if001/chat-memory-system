import { PolicyCard } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";

interface ApplicableResult {
  applicableIds: string[];
}

export const filterApplicablePolicyCards = async (
  llm: JsonGeneratingClient,
  currentContext: string,
  cards: PolicyCard[],
): Promise<PolicyCard[]> => {
  if (cards.length === 0) {
    return [];
  }
  const systemPrompt = [
    "あなたは policy applicability classifier です。",
    "現在の文脈に適用できる policy card ID を選んでください。",
    "JSON のみを返してください。",
  ].join(" ");
  const userPrompt = JSON.stringify({
    currentContext,
    policyCards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      appliesWhen: c.appliesWhen,
      distinctionNotes: c.distinctionNotes,
      recommendedBehavior: c.recommendedBehavior,
      avoidBehavior: c.avoidBehavior,
    })),
  });
  const parsed = await llm.generateJson<ApplicableResult>(systemPrompt, userPrompt);
  const selected = new Set(parsed.applicableIds ?? []);
  return cards.filter((card) => selected.has(card.id));
};
