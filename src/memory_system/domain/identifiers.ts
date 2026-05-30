import { createHash } from "node:crypto";
import { TurnRecord } from "./types";

export const buildTurnRecordId = (
  record: Omit<TurnRecord, "id"> & Partial<Pick<TurnRecord, "id">>,
): string => {
  if (record.id && record.id.trim().length > 0) {
    return record.id.trim();
  }
  return `turn_${stableHash(JSON.stringify({
    botId: record.botId,
    threadId: record.threadId,
    createdAtIso: record.createdAtIso,
    messages: record.messages,
  }))}`;
};

export const buildConversationChunkId = (
  botId: string,
  threadId: string,
  turnRecordIds: string[],
): string =>
  `chunk_${sanitizeIdPart(botId)}_${sanitizeIdPart(threadId)}_${stableHash(turnRecordIds.join("__"))}`;

export const buildEpisodeId = (
  botId: string,
  threadId: string,
  source: string,
): string => `ep_${sanitizeIdPart(botId)}_${sanitizeIdPart(threadId)}_${sanitizeIdPart(source)}`;

export const buildSplitCandidateId = (
  episodeId: string,
  targetPolicyCardId?: string,
): string =>
  `split_${sanitizeIdPart(episodeId)}_${sanitizeIdPart(targetPolicyCardId ?? "unassigned")}`;

export const ensureTurnRecordId = (
  record: TurnRecord,
): TurnRecord & { id: string } => ({
  ...record,
  id: buildTurnRecordId(record),
});

const stableHash = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 16);

const sanitizeIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_");
