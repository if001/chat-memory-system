import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  PolicyConfidence,
  PolicySplitCandidate,
  TurnRecord,
} from "../../domain/types";
import {
  ensureTurnRecordId,
} from "../../domain/identifiers";
import { createDrizzleClient } from "./drizzleClient";
import {
  memoryConversationChunksTable,
  memoryEpisodeCasesTable,
  memoryPolicyCardsTable,
  memoryPolicySplitCandidatesTable,
  memoryTurnRecordsTable,
} from "./schema";

export class MemoryRepository {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.db = createDrizzleClient(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async saveTurnRecord(input: TurnRecord): Promise<void> {
    const record = ensureTurnRecordId(input);
    await this.db
      .insert(memoryTurnRecordsTable)
      .values({
        id: record.id,
        botId: record.botId,
        threadId: record.threadId,
        messagesJson: record.messages,
        createdAt: new Date(record.createdAtIso),
      })
      .onConflictDoNothing();
  }

  async fetchTurnRecordsForThread(
    botId: string,
    threadId: string,
    limit: number,
  ): Promise<TurnRecord[]> {
    const rows = await this.db
      .select()
      .from(memoryTurnRecordsTable)
      .where(
        and(
          eq(memoryTurnRecordsTable.botId, botId),
          eq(memoryTurnRecordsTable.threadId, threadId),
        ),
      )
      .orderBy(desc(memoryTurnRecordsTable.createdAt))
      .limit(limit);

    return rows.map((row) => mapTurnRecordRow(row)).reverse();
  }

  async fetchRecentTurnRecordsForThread(
    botId: string,
    threadId: string,
    limit: number,
  ): Promise<TurnRecord[]> {
    const rows = await this.db
      .select()
      .from(memoryTurnRecordsTable)
      .where(
        and(
          eq(memoryTurnRecordsTable.botId, botId),
          eq(memoryTurnRecordsTable.threadId, threadId),
        ),
      )
      .orderBy(desc(memoryTurnRecordsTable.createdAt))
      .limit(limit);

    return rows.map((row) => mapTurnRecordRow(row)).reverse();
  }

  async fetchThreadIdsForBot(botId: string, limit: number): Promise<string[]> {
    const rows = await this.db.execute(sql`
      SELECT thread_id, MAX(created_at) AS latest_created_at
      FROM app.memory_turn_records
      WHERE bot_id = ${botId}
      GROUP BY thread_id
      ORDER BY latest_created_at DESC
      LIMIT ${limit}
    `);
    return rows.rows.map((row) => row.thread_id as string);
  }

  async saveConversationChunks(chunks: ConversationChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    await this.db
      .insert(memoryConversationChunksTable)
      .values(
        chunks.map((chunk) => ({
          id: chunk.id,
          botId: chunk.botId,
          threadId: chunk.threadId,
          turnRecordIdsJson: chunk.turnRecordIds,
          startCreatedAt: new Date(chunk.startCreatedAtIso),
          endCreatedAt: new Date(chunk.endCreatedAtIso),
          chunkText: chunk.chunkText,
          turnCount: chunk.turnCount,
          tokenEstimate: chunk.tokenEstimate,
          createdAt: new Date(chunk.createdAtIso),
          processedAt: chunk.processedAtIso
            ? new Date(chunk.processedAtIso)
            : null,
        })),
      )
      .onConflictDoNothing();
  }

  async fetchConversationChunksForThread(
    botId: string,
    threadId: string,
    limit: number,
  ): Promise<ConversationChunk[]> {
    const rows = await this.db
      .select()
      .from(memoryConversationChunksTable)
      .where(
        and(
          eq(memoryConversationChunksTable.botId, botId),
          eq(memoryConversationChunksTable.threadId, threadId),
        ),
      )
      .orderBy(memoryConversationChunksTable.startCreatedAt)
      .limit(limit);
    return rows.map(mapConversationChunkRow);
  }

  async fetchPendingConversationChunks(
    botId: string,
    limit: number,
  ): Promise<ConversationChunk[]> {
    const rows = await this.db
      .select()
      .from(memoryConversationChunksTable)
      .where(
        and(
          eq(memoryConversationChunksTable.botId, botId),
          isNull(memoryConversationChunksTable.processedAt),
        ),
      )
      .orderBy(memoryConversationChunksTable.startCreatedAt)
      .limit(limit);
    return rows.map(mapConversationChunkRow);
  }

  async markConversationChunkProcessed(chunkId: string): Promise<void> {
    await this.db
      .update(memoryConversationChunksTable)
      .set({ processedAt: new Date() })
      .where(eq(memoryConversationChunksTable.id, chunkId));
  }

  async saveEpisodeCase(episode: EpisodeCase): Promise<void> {
    await this.db
      .insert(memoryEpisodeCasesTable)
      .values({
        id: episode.id,
        botId: episode.botId,
        threadId: episode.threadId,
        sourceChunkId: episode.sourceChunkId ?? null,
        stateLabel: episode.stateLabel,
        stateDescription: episode.stateDescription,
        actionLabel: episode.actionLabel,
        actionDescription: episode.actionDescription,
        outcome: episode.outcome,
        outcomeAssessmentJson: episode.outcomeAssessment,
        feedbackSignalsJson: episode.feedbackSignals,
        policyUpdateNote: episode.policyUpdateNote,
        createdAt: new Date(episode.createdAtIso),
      })
      .onConflictDoNothing();
  }

  async fetchRecentEpisodes(
    botId: string,
    limit: number,
  ): Promise<EpisodeCase[]> {
    const rows = await this.db
      .select()
      .from(memoryEpisodeCasesTable)
      .where(eq(memoryEpisodeCasesTable.botId, botId))
      .orderBy(desc(memoryEpisodeCasesTable.createdAt))
      .limit(limit);
    return rows.map(mapEpisodeCaseRow);
  }

  async fetchEpisodeById(
    botId: string,
    episodeId: string,
  ): Promise<EpisodeCase | null> {
    const rows = await this.db
      .select()
      .from(memoryEpisodeCasesTable)
      .where(
        and(
          eq(memoryEpisodeCasesTable.botId, botId),
          eq(memoryEpisodeCasesTable.id, episodeId),
        ),
      )
      .limit(1);
    return rows[0] ? mapEpisodeCaseRow(rows[0]) : null;
  }

  async fetchPendingEpisodes(
    botId: string,
    limit: number,
  ): Promise<EpisodeCase[]> {
    const rows = await this.db
      .select()
      .from(memoryEpisodeCasesTable)
      .where(
        and(
          eq(memoryEpisodeCasesTable.botId, botId),
          isNull(memoryEpisodeCasesTable.processedAt),
        ),
      )
      .orderBy(memoryEpisodeCasesTable.createdAt)
      .limit(limit);
    return rows.map(mapEpisodeCaseRow);
  }

  async markEpisodeProcessed(episodeId: string): Promise<void> {
    await this.db
      .update(memoryEpisodeCasesTable)
      .set({ processedAt: new Date() })
      .where(eq(memoryEpisodeCasesTable.id, episodeId));
  }

  async upsertPolicyCard(card: PolicyCard): Promise<void> {
    await this.db
      .insert(memoryPolicyCardsTable)
      .values({
        id: card.id,
        botId: card.botId,
        title: card.title,
        appliesWhen: card.appliesWhen,
        recommendedBehavior: card.recommendedBehavior,
        avoidBehavior: card.avoidBehavior,
        distinctionNotes: card.distinctionNotes,
        confidence: card.confidence,
        evidenceEpisodeIdsJson: card.evidenceEpisodeIds,
        lastUpdated: new Date(card.lastUpdatedIso),
      })
      .onConflictDoUpdate({
        target: memoryPolicyCardsTable.id,
        set: {
          title: card.title,
          appliesWhen: card.appliesWhen,
          recommendedBehavior: card.recommendedBehavior,
          avoidBehavior: card.avoidBehavior,
          distinctionNotes: card.distinctionNotes,
          confidence: card.confidence,
          evidenceEpisodeIdsJson: card.evidenceEpisodeIds,
          lastUpdated: new Date(card.lastUpdatedIso),
        },
      });
  }

  async fetchPolicyCards(botId: string, limit: number): Promise<PolicyCard[]> {
    const rows = await this.db
      .select()
      .from(memoryPolicyCardsTable)
      .where(eq(memoryPolicyCardsTable.botId, botId))
      .orderBy(desc(memoryPolicyCardsTable.lastUpdated))
      .limit(limit);
    return rows.map(mapPolicyCardRow);
  }

  async fetchPolicyCardById(
    botId: string,
    policyCardId: string,
  ): Promise<PolicyCard | null> {
    const rows = await this.db
      .select()
      .from(memoryPolicyCardsTable)
      .where(
        and(
          eq(memoryPolicyCardsTable.botId, botId),
          eq(memoryPolicyCardsTable.id, policyCardId),
        ),
      )
      .limit(1);
    return rows[0] ? mapPolicyCardRow(rows[0]) : null;
  }

  async savePolicySplitCandidate(
    candidate: PolicySplitCandidate,
  ): Promise<void> {
    await this.db
      .insert(memoryPolicySplitCandidatesTable)
      .values({
        id: candidate.id,
        botId: candidate.botId,
        episodeId: candidate.episodeId,
        targetPolicyCardId: candidate.targetPolicyCardId ?? null,
        reason: candidate.reason,
        status: candidate.status,
        createdAt: new Date(candidate.createdAtIso),
      })
      .onConflictDoNothing();
  }

  async fetchOpenSplitCandidates(
    botId: string,
    limit: number,
  ): Promise<PolicySplitCandidate[]> {
    const rows = await this.db
      .select()
      .from(memoryPolicySplitCandidatesTable)
      .where(
        and(
          eq(memoryPolicySplitCandidatesTable.botId, botId),
          eq(memoryPolicySplitCandidatesTable.status, "open"),
        ),
      )
      .orderBy(desc(memoryPolicySplitCandidatesTable.createdAt))
      .limit(limit);
    return rows.map(mapPolicySplitCandidateRow);
  }

  async fetchPolicySplitCandidateById(
    botId: string,
    candidateId: string,
  ): Promise<PolicySplitCandidate | null> {
    const rows = await this.db
      .select()
      .from(memoryPolicySplitCandidatesTable)
      .where(
        and(
          eq(memoryPolicySplitCandidatesTable.botId, botId),
          eq(memoryPolicySplitCandidatesTable.id, candidateId),
        ),
      )
      .limit(1);
    return rows[0] ? mapPolicySplitCandidateRow(rows[0]) : null;
  }

  async updatePolicySplitCandidateStatus(
    botId: string,
    candidateId: string,
    status: PolicySplitCandidate["status"],
  ): Promise<void> {
    await this.db
      .update(memoryPolicySplitCandidatesTable)
      .set({ status })
      .where(
        and(
          eq(memoryPolicySplitCandidatesTable.botId, botId),
          eq(memoryPolicySplitCandidatesTable.id, candidateId),
        ),
      );
  }
}

const toPolicyConfidence = (value: string): PolicyConfidence => {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
};

const mapTurnRecordRow = (
  row: typeof memoryTurnRecordsTable.$inferSelect,
): TurnRecord => ({
  id: row.id,
  botId: row.botId,
  threadId: row.threadId,
  messages: row.messagesJson,
  createdAtIso: new Date(row.createdAt).toISOString(),
});

const mapConversationChunkRow = (
  row: typeof memoryConversationChunksTable.$inferSelect,
): ConversationChunk => ({
  id: row.id,
  botId: row.botId,
  threadId: row.threadId,
  turnRecordIds: row.turnRecordIdsJson ?? [],
  startCreatedAtIso: new Date(row.startCreatedAt).toISOString(),
  endCreatedAtIso: new Date(row.endCreatedAt).toISOString(),
  chunkText: row.chunkText,
  turnCount: row.turnCount,
  tokenEstimate: row.tokenEstimate,
  createdAtIso: new Date(row.createdAt).toISOString(),
  processedAtIso: row.processedAt
    ? new Date(row.processedAt).toISOString()
    : undefined,
});

const mapEpisodeCaseRow = (
  row: typeof memoryEpisodeCasesTable.$inferSelect,
): EpisodeCase => ({
  id: row.id,
  botId: row.botId,
  threadId: row.threadId,
  sourceChunkId: row.sourceChunkId ?? undefined,
  stateLabel: row.stateLabel,
  stateDescription: row.stateDescription,
  actionLabel: row.actionLabel,
  actionDescription: row.actionDescription,
  outcome: row.outcome,
  outcomeAssessment: row.outcomeAssessmentJson,
  feedbackSignals: row.feedbackSignalsJson ?? [],
  policyUpdateNote: row.policyUpdateNote,
  createdAtIso: new Date(row.createdAt).toISOString(),
});

const mapPolicyCardRow = (
  row: typeof memoryPolicyCardsTable.$inferSelect,
): PolicyCard => ({
  id: row.id,
  botId: row.botId,
  title: row.title,
  appliesWhen: row.appliesWhen,
  recommendedBehavior: row.recommendedBehavior,
  avoidBehavior: row.avoidBehavior,
  distinctionNotes: row.distinctionNotes,
  confidence: toPolicyConfidence(row.confidence),
  evidenceEpisodeIds: row.evidenceEpisodeIdsJson ?? [],
  lastUpdatedIso: new Date(row.lastUpdated).toISOString(),
});

const mapPolicySplitCandidateRow = (
  row: typeof memoryPolicySplitCandidatesTable.$inferSelect,
): PolicySplitCandidate => ({
  id: row.id,
  botId: row.botId,
  episodeId: row.episodeId,
  targetPolicyCardId: row.targetPolicyCardId ?? undefined,
  reason: row.reason,
  status: row.status,
  createdAtIso: new Date(row.createdAt).toISOString(),
});
