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
  source?: "user" | "simple_pomdp" | "scheduled" | "unknown";
  messages: TurnMessage[];
  createdAtIso: string;
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
  state: string;
  action: string;
  outcome: string;
  stateEmbeddingVector: EmbeddingVector;
  actionEmbeddingVector: EmbeddingVector;
  outcomeEmbeddingVector: EmbeddingVector;
  relatedEpisodeIds: string[];
}

export interface PolicyCard {
  id: string;
  botId: string;
  state: string;
  action: string;
  outcome: string;
  stateEmbeddingVector: EmbeddingVector;
  actionEmbeddingVector: EmbeddingVector;
  outcomeEmbeddingVector: EmbeddingVector;
  relatedEpisodeIds: string[];
  createdAtIso: string;
  lastUpdatedIso: string;
}

export interface PolicyEvaluation {
  consistent: boolean;
  clear: boolean;
}
