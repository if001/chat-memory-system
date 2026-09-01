import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../../domain/types";
import { ensureTurnRecordId } from "../../domain/identifiers";
import { createDrizzleClient } from "./drizzleClient";
import {
  memoryConversationChunksTable,
  memoryEpisodeCasesTable,
  memoryPolicyCardsTable,
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
        kind: record.kind,
        sourceInteractionId: record.sourceInteractionId,
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
    return rows.map(mapTurnRecordRow).reverse();
  }

  async fetchRecentTurnRecordsForThread(
    botId: string,
    threadId: string,
    limit: number,
  ): Promise<TurnRecord[]> {
    return this.fetchTurnRecordsForThread(botId, threadId, limit);
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
        state: episode.state,
        action: episode.action,
        outcome: episode.outcome,
        stateEmbeddingVectorJson: episode.stateEmbeddingVector,
        actionEmbeddingVectorJson: episode.actionEmbeddingVector,
        outcomeEmbeddingVectorJson: episode.outcomeEmbeddingVector,
        relatedCardId: episode.relatedCardId ?? null,
        createdAt: new Date(episode.createdAtIso),
      })
      .onConflictDoNothing();
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

  async fetchRecentEpisodes(botId: string, limit: number): Promise<EpisodeCase[]> {
    const rows = await this.db
      .select()
      .from(memoryEpisodeCasesTable)
      .where(eq(memoryEpisodeCasesTable.botId, botId))
      .orderBy(desc(memoryEpisodeCasesTable.createdAt))
      .limit(limit);
    return rows.map(mapEpisodeCaseRow);
  }

  async fetchUnassignedEpisodes(
    botId: string,
    limit: number,
  ): Promise<EpisodeCase[]> {
    const rows = await this.db
      .select()
      .from(memoryEpisodeCasesTable)
      .where(
        and(
          eq(memoryEpisodeCasesTable.botId, botId),
          isNull(memoryEpisodeCasesTable.relatedCardId),
        ),
      )
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

  async fetchEpisodesByIds(
    botId: string,
    episodeIds: string[],
  ): Promise<EpisodeCase[]> {
    if (episodeIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(memoryEpisodeCasesTable)
      .where(
        and(
          eq(memoryEpisodeCasesTable.botId, botId),
          inArray(memoryEpisodeCasesTable.id, episodeIds),
        ),
      );
    return rows.map(mapEpisodeCaseRow);
  }

  async updateEpisodeRelatedCard(
    botId: string,
    episodeIds: string[],
    relatedCardId?: string,
  ): Promise<void> {
    if (episodeIds.length === 0) {
      return;
    }
    await this.db
      .update(memoryEpisodeCasesTable)
      .set({ relatedCardId: relatedCardId ?? null })
      .where(
        and(
          eq(memoryEpisodeCasesTable.botId, botId),
          inArray(memoryEpisodeCasesTable.id, episodeIds),
        ),
      );
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
        appliesWhen: card.appliesWhen,
        recommendedBehavior: card.recommendedBehavior,
        avoidBehavior: card.avoidBehavior ?? null,
        episodeIdsJson: card.episodeIds,
        createdAt: new Date(card.createdAtIso),
        lastUpdated: new Date(card.lastUpdatedIso),
      })
      .onConflictDoUpdate({
        target: memoryPolicyCardsTable.id,
        set: {
          botId: card.botId,
          appliesWhen: card.appliesWhen,
          recommendedBehavior: card.recommendedBehavior,
          avoidBehavior: card.avoidBehavior ?? null,
          episodeIdsJson: card.episodeIds,
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
}

const mapTurnRecordRow = (
  row: typeof memoryTurnRecordsTable.$inferSelect,
): TurnRecord => ({
  id: row.id,
  botId: row.botId,
  threadId: row.threadId,
  kind: row.kind,
  sourceInteractionId: row.sourceInteractionId ?? undefined,
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
  state: row.state,
  action: row.action,
  outcome: row.outcome,
  stateEmbeddingVector: row.stateEmbeddingVectorJson ?? [],
  actionEmbeddingVector: row.actionEmbeddingVectorJson ?? [],
  outcomeEmbeddingVector: row.outcomeEmbeddingVectorJson ?? [],
  relatedCardId: row.relatedCardId ?? undefined,
  createdAtIso: new Date(row.createdAt).toISOString(),
});

const mapPolicyCardRow = (
  row: typeof memoryPolicyCardsTable.$inferSelect,
): PolicyCard => ({
  id: row.id,
  botId: row.botId,
  appliesWhen: row.appliesWhen,
  recommendedBehavior: row.recommendedBehavior,
  avoidBehavior: row.avoidBehavior ?? undefined,
  episodeIds: row.episodeIdsJson ?? [],
  createdAtIso: new Date(row.createdAt).toISOString(),
  lastUpdatedIso: new Date(row.lastUpdated).toISOString(),
});
