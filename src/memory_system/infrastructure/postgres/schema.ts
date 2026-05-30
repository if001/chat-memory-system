import {
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  ConversationChunk,
  EpisodeCase,
  MemoryReport,
  PolicyCard,
  PolicySplitCandidate,
  TurnRecord,
} from "../../domain/types";

const appSchema = pgSchema("app");

export const memoryTurnRecordsTable = appSchema.table("memory_turn_records", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  threadId: text("thread_id").notNull(),
  messagesJson: jsonb("messages_json").$type<TurnRecord["messages"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const memoryConversationChunksTable = appSchema.table("memory_conversation_chunks", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  threadId: text("thread_id").notNull(),
  turnRecordIdsJson: jsonb("turn_record_ids_json")
    .$type<ConversationChunk["turnRecordIds"]>()
    .notNull(),
  startCreatedAt: timestamp("start_created_at", { withTimezone: true }).notNull(),
  endCreatedAt: timestamp("end_created_at", { withTimezone: true }).notNull(),
  chunkText: text("chunk_text").notNull(),
  turnCount: integer("turn_count").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const memoryEpisodeCasesTable = appSchema.table("memory_episode_cases", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  threadId: text("thread_id").notNull(),
  sourceChunkId: text("source_chunk_id"),
  stateLabel: text("state_label").notNull(),
  stateDescription: text("state_description").notNull(),
  actionLabel: text("action_label").notNull(),
  actionDescription: text("action_description").notNull(),
  outcome: text("outcome").notNull(),
  outcomeAssessmentJson: jsonb("outcome_assessment_json")
    .$type<EpisodeCase["outcomeAssessment"]>()
    .notNull(),
  feedbackSignalsJson: jsonb("feedback_signals_json")
    .$type<EpisodeCase["feedbackSignals"]>()
    .notNull(),
  policyUpdateNote: text("policy_update_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const memoryPolicyCardsTable = appSchema.table("memory_policy_cards", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  title: text("title").notNull(),
  appliesWhen: text("applies_when").notNull(),
  recommendedBehavior: text("recommended_behavior").notNull(),
  avoidBehavior: text("avoid_behavior").notNull(),
  distinctionNotes: text("distinction_notes").notNull(),
  confidence: text("confidence").$type<PolicyCard["confidence"]>().notNull(),
  evidenceEpisodeIdsJson: jsonb("evidence_episode_ids_json")
    .$type<PolicyCard["evidenceEpisodeIds"]>()
    .notNull(),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull(),
});

export const memoryReportsTable = appSchema.table("memory_reports", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  threadId: text("thread_id").notNull(),
  gapsJson: jsonb("gaps_json").$type<MemoryReport["gaps"]>().notNull(),
  staleNotesJson: jsonb("stale_notes_json").$type<MemoryReport["staleNotes"]>().notNull(),
  conflictsJson: jsonb("conflicts_json").$type<MemoryReport["conflicts"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const memoryPolicySplitCandidatesTable = appSchema.table("memory_policy_split_candidates", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  episodeId: text("episode_id").notNull(),
  targetPolicyCardId: text("target_policy_card_id"),
  reason: text("reason").notNull(),
  status: text("status").$type<PolicySplitCandidate["status"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
