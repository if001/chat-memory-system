import { ConversationChunk, EpisodeCase, TurnRecord } from "../../domain/types";
import { buildEpisodeId, ensureTurnRecordId } from "../../domain/identifiers";
import { JsonGeneratingClient } from "../../ports/jsonGeneratingClient";
import { conversationChunkForLlm, turnRecordForLlm } from "./llmPayloads";
import { z } from "zod";

interface ExtractEpisodeResult {
  episodes?: Array<{
    state: string;
    action: string;
    outcome: string;
  }>;
  state?: string;
  action?: string;
  outcome?: string;
}

const episodeFieldsSchema = z.object({
  state: z.string(),
  action: z.string(),
  outcome: z.string(),
});

const extractEpisodeResultSchema: z.ZodType<ExtractEpisodeResult> = z.object({
  episodes: z.array(episodeFieldsSchema).optional(),
  state: z.string().optional(),
  action: z.string().optional(),
  outcome: z.string().optional(),
});

export const extractEpisodeCase = async (
  llm: JsonGeneratingClient,
  record: TurnRecord,
  embedText?: (text: string) => Promise<number[]>,
): Promise<EpisodeCase> => {
  const episodes = await extractEpisodeCases(llm, record, embedText);
  if (episodes.length === 0) {
    throw new Error("extractEpisodeCase produced no episodes");
  }
  return episodes[0];
};

export const extractEpisodeCases = async (
  llm: JsonGeneratingClient,
  record: TurnRecord,
  embedText?: (text: string) => Promise<number[]>,
): Promise<EpisodeCase[]> => {
  if (record.kind !== "human") {
    return [];
  }
  const normalizedRecord = ensureTurnRecordId(record);
  return extractEpisodeCasesFromConversationSource(
    llm,
    {
      botId: normalizedRecord.botId,
      threadId: normalizedRecord.threadId,
      source: normalizedRecord.id,
    },
    turnRecordForLlm(normalizedRecord),
    embedText,
  );
};

export const extractEpisodeCasesFromChunk = async (
  llm: JsonGeneratingClient,
  chunk: ConversationChunk,
  embedText?: (text: string) => Promise<number[]>,
): Promise<EpisodeCase[]> => {
  return extractEpisodeCasesFromConversationSource(
    llm,
    {
      botId: chunk.botId,
      threadId: chunk.threadId,
      source: chunk.id,
      sourceChunkId: chunk.id,
    },
    conversationChunkForLlm(chunk),
    embedText,
  );
};

const extractEpisodeCasesFromConversationSource = async (
  llm: JsonGeneratingClient,
  identity: {
    botId: string;
    threadId: string;
    source: string;
    sourceChunkId?: string;
  },
  conversation: TurnRecord | Record<string, unknown>,
  embedText?: (text: string) => Promise<number[]>,
): Promise<EpisodeCase[]> => {
  const parsed = await llm.generateJson(
    extractEpisodeResultSchema,
    [
      "あなたは、ユーザーと対話するAgentの行動方針を抽出するEpisode抽出器です。",
      "会話から、Episode を 1件もしくは1件以上抽出してください。",
      "Episodeは具体的な事実を客観的にまとめ、state, action, outcomeの形式としてください。",
      "出力は以下のJson形式とします。",
      '{ "episodes": Array<{"state": string, "action": string, "outcome": string }>, "state": string, "action": string, "outcome": string }',
      "各フィールドは以下です。",
      "- state: そのときのユーザー要求、会話文脈、対象領域、目的",
      "- action: Agentが実際に行った応答戦略や情報取得戦略",
      "- outcome: actionの後に生じた、ユーザー理解や会話状態の変化",
      "",
      "JSON のみを返してください。",
    ].join(" "),
    JSON.stringify({
      instruction:
        "episodes を返してください。各 episode は state, action, outcome を持ち、会話内で実際に起きた具体例だけを書いてください。",
      conversation,
    }),
  );

  const rawEpisodes =
    parsed.episodes && parsed.episodes.length > 0
      ? parsed.episodes
      : parsed.state && parsed.action && parsed.outcome
        ? [
            parsed as Required<
              Pick<ExtractEpisodeResult, "state" | "action" | "outcome">
            >,
          ]
        : [];

  return Promise.all(
    rawEpisodes.map(async (episode, index) => {
      const state = requireText(episode.state, "state");
      const action = requireText(episode.action, "action");
      const outcome = requireText(episode.outcome, "outcome");
      const [
        stateEmbeddingVector,
        actionEmbeddingVector,
        outcomeEmbeddingVector,
      ] = embedText
        ? await Promise.all([
            embedText(state),
            embedText(action),
            embedText(outcome),
          ])
        : [[], [], []];

      return {
        id: buildEpisodeId(
          identity.botId,
          identity.threadId,
          identity.source,
          index,
        ),
        botId: identity.botId,
        threadId: identity.threadId,
        ...(identity.sourceChunkId
          ? { sourceChunkId: identity.sourceChunkId }
          : {}),
        state,
        action,
        outcome,
        stateEmbeddingVector,
        actionEmbeddingVector,
        outcomeEmbeddingVector,
        createdAtIso: new Date().toISOString(),
      };
    }),
  );
};

const requireText = (value: string | undefined, fieldName: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`extractEpisodeCases returned empty ${fieldName}`);
  }
  return normalized;
};
