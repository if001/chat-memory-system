import { TurnRecord } from "../../domain/types";

export interface TurnSearchIndexEntry {
  turnRecordId: string;
  botId: string;
  threadId: string;
  kind: TurnRecord["kind"];
  roles: TurnRecord["messages"][number]["role"][];
  occurredAtIso: string;
  excerpt: string;
  embedding: number[];
}

export const buildTurnSearchText = (record: TurnRecord): string =>
  [
    `kind: ${record.kind}`,
    ...record.messages.map(
      (message) => `role: ${message.role}\n${message.content}`,
    ),
  ].join("\n\n");

export const buildTurnExcerpt = (
  record: TurnRecord,
  maxLength: number = 600,
): string => {
  const text = record.messages
    .map((message) => `${message.role}: ${message.content.trim()}`)
    .join("\n");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
};

export const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};
