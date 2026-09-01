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
  const agentInitiatedResponseMaxHours =
    config?.agentInitiatedResponseMaxHours ?? 24;
  if (
    !Number.isFinite(agentInitiatedResponseMaxHours) ||
    agentInitiatedResponseMaxHours < 0
  ) {
    throw new Error("agentInitiatedResponseMaxHours must be >= 0");
  }

  return {
    chunkSizeTurns,
    chunkOverlapTurns,
    agentInitiatedResponseMaxHours,
  };
};

export const buildConversationChunks = (
  turnRecords: TurnRecord[],
  config: Partial<ChunkingConfig>,
): ConversationChunk[] => {
  if (turnRecords.length === 0) {
    return [];
  }

  const normalizedConfig = normalizeChunkingConfig(config);
  const sorted = buildChunkableTurns(
    turnRecords.map(ensureTurnRecordId).sort((a, b) =>
      a.createdAtIso.localeCompare(b.createdAtIso),
    ),
    normalizedConfig,
  );
  if (sorted.length === 0) {
    return [];
  }
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
      const kindLabel = turn.kind === "human" ? "" : `, kind=${turn.kind}`;
      return `Turn ${turnIndex + 1} (${turn.createdAtIso}${kindLabel})\n${messages}`;
    })
    .join("\n\n");

const formatMessage = (message: TurnMessage): string =>
  `[${message.role}] ${message.content}`;

const buildChunkableTurns = (
  sortedTurns: Array<TurnRecord & { id: string }>,
  config: ChunkingConfig,
): Array<TurnRecord & { id: string }> => {
  const includedSimplePomdpTurnIds = new Set<string>();
  const maxHoursMs = config.agentInitiatedResponseMaxHours * 60 * 60 * 1000;

  sortedTurns.forEach((turn, index) => {
    if (!isRealUserTurn(turn)) {
      return;
    }
    const responseAt = Date.parse(turn.createdAtIso);
    const searchStart = Math.max(0, index - config.chunkSizeTurns);
    for (let candidateIndex = searchStart; candidateIndex < index; candidateIndex += 1) {
      const candidate = sortedTurns[candidateIndex];
      if (
        !candidate ||
        candidate.kind !== "proactive" ||
        !candidate.sourceInteractionId ||
        candidate.sourceInteractionId !== turn.sourceInteractionId
      ) {
        continue;
      }
      if (responseAt - Date.parse(candidate.createdAtIso) <= maxHoursMs) {
        includedSimplePomdpTurnIds.add(candidate.id);
      }
    }
  });

  return sortedTurns.flatMap((turn) => {
    if (turn.kind === "delegation") {
      return [];
    }
    if (turn.kind !== "proactive") {
      return [turn];
    }
    if (!includedSimplePomdpTurnIds.has(turn.id)) {
      return [];
    }
    const assistantMessages = turn.messages.filter(
      (message) => message.role === "assistant",
    );
    if (assistantMessages.length === 0) {
      return [];
    }
    return [
      {
        ...turn,
        messages: assistantMessages,
      },
    ];
  });
};

const isRealUserTurn = (turn: TurnRecord): boolean =>
  turn.kind === "human" &&
  turn.messages.some(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );

const estimateTokens = (turnRecords: TurnRecord[]): number => {
  const text = turnRecords
    .flatMap((turn) => turn.messages.map((message) => message.content))
    .join("\n");
  return Math.max(1, Math.ceil(text.length / 4));
};
