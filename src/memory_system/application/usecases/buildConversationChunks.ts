import {
  ChunkingConfig,
  ConversationChunk,
  TurnMessage,
  TurnRecord,
} from "../../domain/types";
import {
  buildConversationChunkId,
  buildTurnRecordId,
  ensureTurnRecordId,
} from "../../domain/identifiers";

export const normalizeChunkingConfig = (
  config: Partial<ChunkingConfig> | undefined,
): ChunkingConfig => {
  const chunkSizeTurns = config?.chunkSizeTurns ?? 6;
  const chunkOverlapTurns = config?.chunkOverlapTurns ?? 2;

  if (!Number.isInteger(chunkSizeTurns) || chunkSizeTurns < 1) {
    throw new Error("chunkSizeTurns must be an integer >= 1");
  }
  if (!Number.isInteger(chunkOverlapTurns) || chunkOverlapTurns < 0) {
    throw new Error("chunkOverlapTurns must be an integer >= 0");
  }
  if (chunkOverlapTurns >= chunkSizeTurns) {
    throw new Error("chunkOverlapTurns must be smaller than chunkSizeTurns");
  }

  return {
    chunkSizeTurns,
    chunkOverlapTurns,
  };
};

export const buildConversationChunks = (
  turnRecords: TurnRecord[],
  config: ChunkingConfig,
): ConversationChunk[] => {
  if (turnRecords.length === 0) {
    return [];
  }

  const normalizedConfig = normalizeChunkingConfig(config);
  const sorted = turnRecords.map(ensureTurnRecordId).sort((a, b) =>
    a.createdAtIso.localeCompare(b.createdAtIso),
  );
  const step = normalizedConfig.chunkSizeTurns - normalizedConfig.chunkOverlapTurns;
  const chunks: ConversationChunk[] = [];

  for (let startIndex = 0; startIndex < sorted.length; startIndex += step) {
    const window = sorted.slice(startIndex, startIndex + normalizedConfig.chunkSizeTurns);
    if (window.length === 0) {
      break;
    }
    if (
      startIndex > 0 &&
      window.length <= normalizedConfig.chunkOverlapTurns
    ) {
      break;
    }
    const first = window[0];
    const last = window[window.length - 1];
    if (!first || !last) {
      break;
    }
    chunks.push({
      id: buildConversationChunkId(
        first.botId,
        first.threadId,
        window.map((turn) => turn.id ?? buildTurnRecordId(turn)),
      ),
      botId: first.botId,
      threadId: first.threadId,
      turnRecordIds: window.map((turn) => turn.id ?? buildTurnRecordId(turn)),
      startCreatedAtIso: first.createdAtIso,
      endCreatedAtIso: last.createdAtIso,
      chunkText: buildChunkText(window),
      turnCount: window.length,
      tokenEstimate: estimateTokens(window),
      createdAtIso: new Date().toISOString(),
    });
    if (window.length < normalizedConfig.chunkSizeTurns) {
      break;
    }
  }

  return chunks;
};

const buildChunkText = (turnRecords: TurnRecord[]): string =>
  turnRecords
    .map((turn, turnIndex) => {
      const messages = turn.messages
        .map((message) => formatMessage(message))
        .join("\n");
      return `Turn ${turnIndex + 1} (${turn.createdAtIso})\n${messages}`;
    })
    .join("\n\n");

const formatMessage = (message: TurnMessage): string =>
  `[${message.role}] ${message.content}`;

const estimateTokens = (turnRecords: TurnRecord[]): number => {
  const text = turnRecords
    .flatMap((turn) => turn.messages.map((message) => message.content))
    .join("\n");
  return Math.max(1, Math.ceil(text.length / 4));
};
