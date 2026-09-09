import { PolicyCard } from "../../domain/types";
import { JsonGeneratingClient } from "../../infrastructure/ollama/fileCachedClient";
import { policyCardsForLlm } from "./llmPayloads";

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

  const userPrompt = JSON.stringify({
    currentContext,
    policyCards: policyCardsForLlm(cards),
  });
  const parsed = await llm.generateJson<string[]>(
    systemPrompt,
    userPrompt,
  );
  const selected = new Set(parsed ?? []);
  return cards.filter((card) => selected.has(card.id));
};
