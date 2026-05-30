import { TurnRecord } from "../../domain/types";

export const buildPolicyQueryContext = (
  currentContext: string,
  recentTurns: TurnRecord[],
  maxTokenEstimate: number = 1000,
): string => {
  const normalizedCurrentContext = currentContext.trim();
  const currentContextTokens = estimateTokens(normalizedCurrentContext);
  const remainingTokenBudget = Math.max(0, maxTokenEstimate - currentContextTokens);

  const selectedTurns: TurnRecord[] = [];
  let usedTokens = 0;
  for (const turn of [...recentTurns].reverse()) {
    const turnText = formatTurn(turn, 0);
    const turnTokens = estimateTokens(turnText);
    if (selectedTurns.length > 0 && usedTokens + turnTokens > remainingTokenBudget) {
      continue;
    }
    if (selectedTurns.length === 0 && turnTokens > remainingTokenBudget) {
      break;
    }
    selectedTurns.unshift(turn);
    usedTokens += turnTokens;
  }

  const historyBlock = selectedTurns
    .map((turn, index) => formatTurn(turn, index + 1))
    .join("\n\n");

  if (!historyBlock) {
    return normalizedCurrentContext;
  }

  if (!normalizedCurrentContext) {
    return [
      "Recent conversation history:",
      historyBlock,
    ].join("\n");
  }

  return [
    "Current user input:",
    normalizedCurrentContext,
    "",
    "Recent conversation history:",
    historyBlock,
  ].join("\n");
};

const formatTurn = (turn: TurnRecord, index: number): string => {
  const messages = turn.messages
    .map((message) => `[${message.role}] ${message.content}`)
    .join("\n");
  return `Recent turn ${index} (${turn.createdAtIso})\n${messages}`;
};

const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));
