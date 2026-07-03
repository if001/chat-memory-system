import { PolicyCard } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";

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
    "返却形式は policy card ID の JSON string array のみです。",
    "JSON のみを返してください。",
  ].join(" ");

  console.log("[filterApplicablePolicyCards]: cards", cards);
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
  const parsed = await llm.generateJson<string[]>(
    systemPrompt,
    userPrompt,
  );
  console.log("[filterApplicablePolicyCards]:parsed", parsed);
  const selected = new Set(parsed ?? []);
  console.log("[filterApplicablePolicyCards]: selected", selected);
  return cards.filter((card) => selected.has(card.id));
};
