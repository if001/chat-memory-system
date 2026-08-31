import { integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../../domain/types";

const appSchema = pgSchema("app");

export const memoryTurnRecordsTable = appSchema.table("memory_turn_records", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  threadId: text("thread_id").notNull(),
  source: text("source").$type<TurnRecord["source"]>(),
  messagesJson: jsonb("messages_json").$type<TurnRecord["messages"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const memoryConversationChunksTable = appSchema.table(
  "memory_conversation_chunks",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    threadId: text("thread_id").notNull(),
    turnRecordIdsJson: jsonb("turn_record_ids_json")
      .$type<ConversationChunk["turnRecordIds"]>()
      .notNull(),
    startCreatedAt: timestamp("start_created_at", {
      withTimezone: true,
    }).notNull(),
    endCreatedAt: timestamp("end_created_at", { withTimezone: true }).notNull(),
    chunkText: text("chunk_text").notNull(),
    turnCount: integer("turn_count").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
);

export const memoryEpisodeCasesTable = appSchema.table("memory_episode_cases", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  threadId: text("thread_id").notNull(),
  sourceChunkId: text("source_chunk_id"),
  state: text("state").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  stateEmbeddingVectorJson: jsonb("state_embedding_vector_json")
    .$type<EpisodeCase["stateEmbeddingVector"]>()
    .notNull(),
  actionEmbeddingVectorJson: jsonb("action_embedding_vector_json")
    .$type<EpisodeCase["actionEmbeddingVector"]>()
    .notNull(),
  outcomeEmbeddingVectorJson: jsonb("outcome_embedding_vector_json")
    .$type<EpisodeCase["outcomeEmbeddingVector"]>()
    .notNull(),
  relatedCardId: text("related_card_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const memoryPolicyCardsTable = appSchema.table("memory_policy_cards", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  state: text("state").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  stateEmbeddingVectorJson: jsonb("state_embedding_vector_json")
    .$type<PolicyCard["stateEmbeddingVector"]>()
    .notNull(),
  actionEmbeddingVectorJson: jsonb("action_embedding_vector_json")
    .$type<PolicyCard["actionEmbeddingVector"]>()
    .notNull(),
  outcomeEmbeddingVectorJson: jsonb("outcome_embedding_vector_json")
    .$type<PolicyCard["outcomeEmbeddingVector"]>()
    .notNull(),
  relatedEpisodeIdsJson: jsonb("related_episode_ids_json")
    .$type<PolicyCard["relatedEpisodeIds"]>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull(),
});
