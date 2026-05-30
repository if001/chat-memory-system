import { PolicyCard } from "../../domain/types";
import { OllamaClient } from "../../infrastructure/ollama/client";

interface ApplicableResult {
  applicableIds: string[];
}

export const filterApplicablePolicyCards = async (
  llm: OllamaClient,
  currentContext: string,
  cards: PolicyCard[],
): Promise<PolicyCard[]> => {
  if (cards.length === 0) {
    return [];
  }
  const systemPrompt = [
    "You are a policy applicability classifier.",
    "Pick policy card IDs applicable to the current context.",
    "Return JSON only.",
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
