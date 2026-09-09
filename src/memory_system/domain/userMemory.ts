interface JsonGeneratingClient {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export interface UserNote {
  id: number;
  note: string;
  createdAt: Date;
}

export type MemoryDestination =
  | "user_memory"
  | "daily_event"
  | "topic_state"
  | "reject";

export type UserMemoryWriteAction =
  | "create"
  | "keep_existing"
  | "replace"
  | "delete";

export type UserMemoryWriteDecision =
  | {
      destination: "user_memory";
      action: UserMemoryWriteAction;
      targetNoteId?: number;
      reason: string;
    }
  | {
      destination: Exclude<MemoryDestination, "user_memory">;
      reason: string;
    };

export interface UserMemoryWriteResult {
  ok: boolean;
  action?: UserMemoryWriteAction;
  destination?: Exclude<MemoryDestination, "user_memory">;
  reason?: string;
  note?: UserNote | null;
  deletedNoteId?: number;
  error?: string;
}

interface RawUserMemoryWriteDecision {
  destination?: string;
  action?: string;
  targetNoteId?: number;
  reason?: string;
}

export const decideUserMemoryWrite = async (
  llm: JsonGeneratingClient,
  input: {
    proposedNote: string;
    candidates: UserNote[];
    explicitTargetNoteId?: number;
  },
): Promise<UserMemoryWriteDecision | null> => {
  const parsed = await llm.generateJson<RawUserMemoryWriteDecision>(
    [
      "You decide how to handle one explicit memory write request.",
      "First choose exactly one destination: user_memory, daily_event, topic_state, or reject.",
      "Use user_memory for stable preferences, constraints, attributes, and ongoing working assumptions. A date mentioned inside a stable constraint does not make it an event. Titles or names containing words such as today are not dates.",
      "Use daily_event only for a concrete occurrence or activity with a clear calendar date. A concrete event without a clear date must be reject, never user_memory.",
      "Use topic_state for interest or reaction evidence caused by proactive, scheduled, or conversation-trigger interactions. The main agent must not persist this evidence directly.",
      "Use reject for ambiguous, transient, insufficiently dated event, or otherwise unsuitable content.",
      "For user_memory, also choose exactly one action: create, keep_existing, replace, or delete.",
      "Use keep_existing for a semantic duplicate, replace for a contradiction or correction, create for a genuinely new stable fact, and delete only when the proposed correction explicitly removes an existing fact without a replacement.",
      "Never target an unrelated note.",
      "targetNoteId must be one of the supplied candidate IDs. If explicitTargetNoteId is supplied, replace or delete may target only that ID.",
      "Return JSON with destination, optional action, optional targetNoteId, and a short natural-language reason.",
    ].join(" "),
    JSON.stringify({
      proposedNote: input.proposedNote,
      candidates: input.candidates.map(({ id, note }) => ({ id, note })),
      ...(input.explicitTargetNoteId !== undefined
        ? { explicitTargetNoteId: input.explicitTargetNoteId }
        : {}),
    }),
  );
  return normalizeDecision(parsed, input);
};

const normalizeDecision = (
  value: RawUserMemoryWriteDecision | null | undefined,
  input: { candidates: UserNote[]; explicitTargetNoteId?: number },
): UserMemoryWriteDecision | null => {
  const destination = value?.destination;
  const action = value?.action;
  const reason = value?.reason?.trim();
  if (!reason) return null;
  if (
    destination === "daily_event" ||
    destination === "topic_state" ||
    destination === "reject"
  ) {
    return { destination, reason };
  }
  if (
    destination !== "user_memory" ||
    (action !== "create" &&
      action !== "keep_existing" &&
      action !== "replace" &&
      action !== "delete")
  ) {
    return null;
  }
  if (action === "create") {
    return input.explicitTargetNoteId === undefined
      ? { destination, action, reason }
      : null;
  }
  const targetNoteId = value?.targetNoteId;
  if (
    !Number.isInteger(targetNoteId) ||
    !input.candidates.some((candidate) => candidate.id === targetNoteId) ||
    (input.explicitTargetNoteId !== undefined &&
      targetNoteId !== input.explicitTargetNoteId)
  ) {
    return null;
  }
  return { destination, action, targetNoteId, reason } as UserMemoryWriteDecision;
};
