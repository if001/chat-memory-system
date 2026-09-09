import { UserNote } from "../../domain/userMemory";

export interface UserMemorySearchIndexEntry {
  noteId: number;
  userId: string;
  note: string;
  embedding: number[];
}

export interface RankedUserMemory extends UserNote {
  score: number;
}

export const rankUserMemory = (
  query: string,
  queryEmbedding: number[],
  candidates: Array<UserMemorySearchIndexEntry & { createdAt: Date }>,
): RankedUserMemory[] =>
  candidates
    .map((candidate) => ({
      id: candidate.noteId,
      note: candidate.note,
      createdAt: candidate.createdAt,
      score:
        cosineSimilarity(queryEmbedding, candidate.embedding) * 0.85 +
        lexicalSimilarity(query, candidate.note) * 0.15,
    }))
    .filter((candidate) => candidate.score >= 0.2)
    .sort((left, right) => right.score - left.score);

const cosineSimilarity = (left: number[], right: number[]): number => {
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

const lexicalSimilarity = (query: string, note: string): number => {
  const queryText = normalize(query);
  const noteText = normalize(note);
  if (!queryText || !noteText) return 0;
  if (noteText.includes(queryText) || queryText.includes(noteText)) return 1;
  const queryTokens = new Set(queryText.split(" ").filter(Boolean));
  const noteTokens = new Set(noteText.split(" ").filter(Boolean));
  const overlap = [...queryTokens].filter((token) => noteTokens.has(token)).length;
  return overlap / Math.max(queryTokens.size, noteTokens.size, 1);
};

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/[\s。、,.!！?？]+/gu, " ");
