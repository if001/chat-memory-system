export type EmbeddingVector = number[];

export interface TurnMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestampIso: string;
}

export interface TurnRecord {
  id?: string;
  botId: string;
  threadId: string;
  kind: "human" | "proactive" | "delegation";
  sourceInteractionId?: string;
  messages: TurnMessage[];
  createdAtIso: string;
}

export interface TurnRecordReader {
  listRecentTurnRecords(input: {
    botId: string;
    threadId: string;
    limit: number;
  }): Promise<TurnRecord[]>;
}

export interface ConversationChunk {
  id: string;
  botId: string;
  threadId: string;
  turnRecordIds: string[];
  startCreatedAtIso: string;
  endCreatedAtIso: string;
  chunkText: string;
  turnCount: number;
  tokenEstimate: number;
  createdAtIso: string;
  processedAtIso?: string;
}

export interface ChunkingConfig {
  chunkSizeTurns: number;
  chunkOverlapTurns: number;
  agentInitiatedResponseMaxHours: number;
}

export interface EpisodeCase {
  id: string;
  botId: string;
  threadId: string;
  sourceChunkId?: string;
  state: string;
  action: string;
  outcome: string;
  stateEmbeddingVector: EmbeddingVector;
  actionEmbeddingVector: EmbeddingVector;
  outcomeEmbeddingVector: EmbeddingVector;
  relatedCardId?: string;
  createdAtIso: string;
}

export interface PolicyHypothesis {
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
  episodeIds: string[];
}

export interface PolicyCard {
  id: string;
  botId: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
  episodeIds: string[];
  createdAtIso: string;
  lastUpdatedIso: string;
}
