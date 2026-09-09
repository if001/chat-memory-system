import {
  and,
  asc,
  arrayOverlaps,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../../domain/types";
import { ensureTurnRecordId } from "../../domain/identifiers";
import { UserNote } from "../../domain/userMemory";
import { UserMemorySearchIndexEntry } from "../../application/usecases/userMemorySearch";
import {
  DailyEvent,
  GetDailyEventsByDateInput,
  RememberDailyEventInput,
  SearchDailyEventsInput,
} from "../../domain/dailyEvent";
import type { TurnRecordSearchRequest } from "../../api/contracts";
import type { TurnSearchIndexEntry } from "../../application/usecases/turnSearchIndex";
import { createDrizzleClient } from "./drizzleClient";
import {
  memoryConversationChunksTable,
  memoryEpisodeCasesTable,
  memoryPolicyCardsTable,
  memoryTurnRecordsTable,
  memoryUserNoteSearchIndexTable,
  userNotesTable,
  dailyEventsTable,
  memoryTurnSearchIndexTable,
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

  async rememberUserNote(userId: string, note: string): Promise<UserNote> {
    const normalized = normalizeNote(note);
    const existing = (await this.searchUserNotes(userId, "", 100)).find(
      (item) => normalizeNote(item.note) === normalized,
    );
    if (existing) return existing;
    const rows = await this.db
      .insert(userNotesTable)
      .values({ userId, note: note.trim() })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return mapUserNote(rows[0]);
    const concurrent = (await this.searchUserNotes(userId, "", 100)).find(
      (item) => normalizeNote(item.note) === normalized,
    );
    if (!concurrent) {
      throw new Error("UserMemory note insert did not return a row");
    }
    return concurrent;
  }

  async searchUserNotes(
    userId: string,
    query: string,
    limit: number,
  ): Promise<UserNote[]> {
    const normalizedQuery = query.trim();
    let statement = this.db.select().from(userNotesTable).$dynamic();
    statement = statement.where(
      normalizedQuery
        ? and(
            eq(userNotesTable.userId, userId),
            ilike(userNotesTable.note, `%${escapeLike(normalizedQuery)}%`),
          )
        : eq(userNotesTable.userId, userId),
    );
    const rows = await statement
      .orderBy(desc(userNotesTable.createdAt))
      .limit(limit);
    return rows.map(mapUserNote);
  }

  async replaceUserNote(
    userId: string,
    noteId: number,
    note: string,
  ): Promise<UserNote | null> {
    const equivalent = (await this.searchUserNotes(userId, "", 100)).find(
      (item) =>
        item.id !== noteId && normalizeNote(item.note) === normalizeNote(note),
    );
    if (equivalent) {
      await this.deleteUserNote(userId, noteId);
      return equivalent;
    }
    const rows = await this.db
      .update(userNotesTable)
      .set({ note: note.trim() })
      .where(
        and(eq(userNotesTable.userId, userId), eq(userNotesTable.id, noteId)),
      )
      .returning();
    return rows[0] ? mapUserNote(rows[0]) : null;
  }

  async deleteUserNote(userId: string, noteId: number): Promise<boolean> {
    const rows = await this.db
      .delete(userNotesTable)
      .where(
        and(eq(userNotesTable.userId, userId), eq(userNotesTable.id, noteId)),
      )
      .returning({ id: userNotesTable.id });
    return rows.length > 0;
  }

  async upsertUserMemorySearchIndex(
    entry: UserMemorySearchIndexEntry,
  ): Promise<void> {
    const values = {
      noteId: entry.noteId,
      userId: entry.userId,
      note: entry.note,
      embeddingJson: entry.embedding,
      indexedAt: new Date(),
    };
    await this.db
      .insert(memoryUserNoteSearchIndexTable)
      .values(values)
      .onConflictDoUpdate({
        target: memoryUserNoteSearchIndexTable.noteId,
        set: values,
      });
  }

  async deleteUserMemorySearchIndex(noteId: number): Promise<void> {
    await this.db
      .delete(memoryUserNoteSearchIndexTable)
      .where(eq(memoryUserNoteSearchIndexTable.noteId, noteId));
  }

  async fetchUserMemorySearchCandidates(
    userId: string,
    limit: number,
  ): Promise<Array<UserMemorySearchIndexEntry & { createdAt: Date }>> {
    const rows = await this.db
      .select({
        index: memoryUserNoteSearchIndexTable,
        createdAt: userNotesTable.createdAt,
      })
      .from(memoryUserNoteSearchIndexTable)
      .innerJoin(
        userNotesTable,
        and(
          eq(userNotesTable.id, memoryUserNoteSearchIndexTable.noteId),
          eq(userNotesTable.userId, memoryUserNoteSearchIndexTable.userId),
        ),
      )
      .where(eq(memoryUserNoteSearchIndexTable.userId, userId))
      .limit(limit);
    return rows.map((row) => ({
      noteId: row.index.noteId,
      userId: row.index.userId,
      note: row.index.note,
      embedding: row.index.embeddingJson,
      createdAt: new Date(row.createdAt),
    }));
  }

  async fetchUnindexedUserNotes(
    userId: string,
    limit: number,
  ): Promise<UserNote[]> {
    const rows = await this.db
      .select({ note: userNotesTable })
      .from(userNotesTable)
      .leftJoin(
        memoryUserNoteSearchIndexTable,
        eq(userNotesTable.id, memoryUserNoteSearchIndexTable.noteId),
      )
      .where(
        and(
          eq(userNotesTable.userId, userId),
          isNull(memoryUserNoteSearchIndexTable.noteId),
        ),
      )
      .orderBy(userNotesTable.createdAt)
      .limit(limit);
    return rows.map(({ note }) => mapUserNote(note));
  }

  async rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent> {
    const [row] = await this.db
      .insert(dailyEventsTable)
      .values({
        userId: input.userId,
        eventDate: normalizeDateInput(input.eventDate),
        summary: input.summary,
        tags: input.tags ?? [],
        ...(input.sourceMessage ? { sourceMessage: input.sourceMessage } : {}),
      })
      .returning();
    if (!row) {
      throw new Error("failed to persist daily event");
    }
    return mapDailyEventRow(row);
  }

  async searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]> {
    const query = input.query.trim();
    const content = sql`concat_ws(' ', ${dailyEventsTable.summary}, ${dailyEventsTable.sourceMessage}, array_to_string(${dailyEventsTable.tags}, ' '))`;
    const conditions = [
      eq(dailyEventsTable.userId, input.userId),
      ...(query
        ? [
            or(
              sql`to_tsvector('simple', ${content}) @@ websearch_to_tsquery('simple', ${query})`,
              sql`${content} ILIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`,
            ),
          ]
        : []),
      ...(input.from
        ? [gte(dailyEventsTable.eventDate, normalizeDateInput(input.from))]
        : []),
      ...(input.to
        ? [lte(dailyEventsTable.eventDate, normalizeDateInput(input.to))]
        : []),
    ];
    const rows = await this.db
      .select()
      .from(dailyEventsTable)
      .where(and(...conditions))
      .orderBy(
        desc(dailyEventsTable.eventDate),
        desc(dailyEventsTable.createdAt),
      )
      .limit(input.limit ?? 10);
    return rows.map(mapDailyEventRow);
  }

  async getDailyEventsByDate(
    input: GetDailyEventsByDateInput,
  ): Promise<DailyEvent[]> {
    const windowDays = input.windowDays ?? 3;
    const center = parseDateOnly(normalizeDateInput(input.date));
    const from = formatDateOnly(addDays(center, -windowDays));
    const to = formatDateOnly(addDays(center, windowDays));
    const rows = await this.db
      .select()
      .from(dailyEventsTable)
      .where(
        and(
          eq(dailyEventsTable.userId, input.userId),
          gte(dailyEventsTable.eventDate, from),
          lte(dailyEventsTable.eventDate, to),
        ),
      )
      .orderBy(asc(dailyEventsTable.eventDate), asc(dailyEventsTable.createdAt))
      .limit(input.limit ?? 20);
    return rows.map(mapDailyEventRow);
  }

  async upsertTurnSearchIndex(entry: TurnSearchIndexEntry): Promise<void> {
    const values = {
      turnRecordId: entry.turnRecordId,
      botId: entry.botId,
      threadId: entry.threadId,
      kind: entry.kind,
      roles: entry.roles,
      occurredAt: new Date(entry.occurredAtIso),
      excerpt: entry.excerpt,
      embeddingJson: entry.embedding,
      indexedAt: new Date(),
    };
    await this.db
      .insert(memoryTurnSearchIndexTable)
      .values(values)
      .onConflictDoUpdate({
        target: memoryTurnSearchIndexTable.turnRecordId,
        set: values,
      });
  }

  async fetchTurnSearchCandidates(
    input: TurnRecordSearchRequest,
    limit: number,
  ): Promise<TurnSearchIndexEntry[]> {
    const rows = await this.db
      .select()
      .from(memoryTurnSearchIndexTable)
      .where(
        and(
          eq(memoryTurnSearchIndexTable.botId, input.botId),
          eq(memoryTurnSearchIndexTable.threadId, input.threadId),
          ...(input.from
            ? [gte(memoryTurnSearchIndexTable.occurredAt, parseFrom(input.from))]
            : []),
          ...(input.to
            ? [lte(memoryTurnSearchIndexTable.occurredAt, parseTo(input.to))]
            : []),
          ...(input.roles?.length
            ? [arrayOverlaps(memoryTurnSearchIndexTable.roles, input.roles)]
            : []),
          ...(input.kinds?.length
            ? [inArray(memoryTurnSearchIndexTable.kind, input.kinds)]
            : []),
        ),
      )
      .orderBy(desc(memoryTurnSearchIndexTable.occurredAt))
      .limit(limit);
    return rows.map((row) => ({
      turnRecordId: row.turnRecordId,
      botId: row.botId,
      threadId: row.threadId,
      kind: row.kind,
      roles: row.roles as TurnSearchIndexEntry["roles"],
      occurredAtIso: new Date(row.occurredAt).toISOString(),
      excerpt: row.excerpt,
      embedding: row.embeddingJson,
    }));
  }

  async fetchUnindexedTurnRecords(
    botId: string,
    limit: number,
  ): Promise<TurnRecord[]> {
    const rows = await this.db
      .select({ record: memoryTurnRecordsTable })
      .from(memoryTurnRecordsTable)
      .leftJoin(
        memoryTurnSearchIndexTable,
        eq(memoryTurnRecordsTable.id, memoryTurnSearchIndexTable.turnRecordId),
      )
      .where(
        and(
          eq(memoryTurnRecordsTable.botId, botId),
          isNull(memoryTurnSearchIndexTable.turnRecordId),
        ),
      )
      .orderBy(memoryTurnRecordsTable.createdAt)
      .limit(limit);
    return rows.map(({ record }) => mapTurnRecordRow(record));
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

const normalizeNote = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/[\s。、,.!！?？]+/gu, " ").trim();

const mapUserNote = (
  row: typeof userNotesTable.$inferSelect,
): UserNote => ({
  id: row.id,
  note: row.note,
  createdAt: new Date(row.createdAt),
});

const mapDailyEventRow = (
  row: typeof dailyEventsTable.$inferSelect,
): DailyEvent => ({
  id: row.id,
  userId: row.userId,
  eventDate: row.eventDate,
  summary: row.summary,
  tags: row.tags,
  ...(row.sourceMessage ? { sourceMessage: row.sourceMessage } : {}),
  createdAt: new Date(row.createdAt),
});

const normalizeDateInput = (value: string): string => {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error(`invalid date format: ${value}`);
};

const escapeLike = (value: string): string => value.replace(/[%_\\]/g, "\\$&");
const parseDateOnly = (value: string): Date =>
  new Date(`${value}T00:00:00.000Z`);
const addDays = (date: Date, delta: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
};
const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10);
const parseFrom = (value: string): Date =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);

const parseTo = (value: string): Date =>
  new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T23:59:59.999Z`
      : value,
  );
