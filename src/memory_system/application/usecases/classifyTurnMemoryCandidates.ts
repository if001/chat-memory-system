import type { TurnRecord } from "../../domain/types";

interface JsonGeneratingClient {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export type TurnMemoryCandidate =
  | { kind: "user_memory"; note: string }
  | { kind: "daily_event"; eventDate: string; summary: string };

interface RawCandidate {
  kind?: string;
  note?: string;
  eventDate?: string;
  summary?: string;
}

export const classifyTurnMemoryCandidates = async (
  llm: JsonGeneratingClient,
  turn: TurnRecord,
): Promise<TurnMemoryCandidate[]> => {
  if (turn.kind !== "human") return [];
  const userMessages = turn.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
  if (userMessages.length === 0) return [];

  const response = await llm.generateJson<{
    candidates?: RawCandidate[];
  } | null>(
    [
      "Extract durable user memory candidates from the supplied human messages.",
      "Return JSON with a candidates array.",
      "Use kind user_memory only for explicit stable preferences, constraints, attributes, or ongoing working assumptions.",
      "Use kind daily_event only for a concrete occurrence or planned activity with an explicit calendar date; return eventDate as YYYY-MM-DD and a concise summary.",
      "Do not save temporary topics, weak interest guesses, assistant claims, instructions, or information without durable value.",
      "A dated event must appear only as daily_event, never also as user_memory.",
      "Return an empty candidates array when nothing should be stored.",
    ].join(" "),
    JSON.stringify({
      turnCreatedAt: turn.createdAtIso,
      humanMessages: userMessages,
    }),
  );

  const normalized = (response?.candidates ?? [])
    .map(normalizeCandidate)
    .filter((candidate): candidate is TurnMemoryCandidate => candidate !== null);
  return normalized.filter(
    (candidate, index) =>
      normalized.findIndex(
        (item) => candidateKey(item) === candidateKey(candidate),
      ) === index,
  );
};

const normalizeCandidate = (
  candidate: RawCandidate,
): TurnMemoryCandidate | null => {
  if (candidate.kind === "user_memory") {
    const note = normalizeText(candidate.note);
    return note ? { kind: "user_memory", note } : null;
  }
  if (candidate.kind === "daily_event") {
    const eventDate = candidate.eventDate?.trim();
    const summary = normalizeText(candidate.summary);
    if (!eventDate || !isDateOnly(eventDate) || !summary) return null;
    return { kind: "daily_event", eventDate, summary };
  }
  return null;
};

const normalizeText = (value: string | undefined): string =>
  value?.replace(/\s+/g, " ").trim() ?? "";

const isDateOnly = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const candidateKey = (candidate: TurnMemoryCandidate): string =>
  candidate.kind === "user_memory"
    ? `user:${candidate.note.toLocaleLowerCase()}`
    : `event:${candidate.eventDate}:${candidate.summary.toLocaleLowerCase()}`;
