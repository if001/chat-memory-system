import {
  ChunkingConfig,
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../domain/types";
import { buildPolicyHypothesisFromEpisodes } from "../application/usecases/buildPolicyCard";
import {
  buildConversationChunks,
  normalizeChunkingConfig,
} from "../application/usecases/buildConversationChunks";
import { buildPolicyQueryContext } from "../application/usecases/buildPolicyQueryContext";
import { extractEpisodeCasesFromChunk } from "../application/usecases/extractEpisodeCase";
import { filterApplicablePolicyCards } from "../application/usecases/filterApplicablePolicyCards";
import { updatePolicyCardFromEpisode } from "../application/usecases/updatePolicyCard";
import {
  OllamaEmbeddingClient,
  TextEmbeddingClient,
} from "../infrastructure/ollama/embeddingClient";
import { OllamaClient } from "../infrastructure/ollama/client";
import {
  createFileCachedJsonClient,
  JsonGeneratingClient,
} from "../infrastructure/ollama/fileCachedClient";
import { MemoryRepository } from "../infrastructure/postgres/repository";
import type {
  MemoryCatalog,
  MemoryCatalogEntry,
  MemoryCatalogRequest,
  MemorySearchRequest,
  MemorySearchResult,
} from "./contracts";
import { validateMemorySearchRequest } from "./contracts";
import {
  UserMemoryWriteResult,
  UserNote,
  decideUserMemoryWrite,
} from "../domain/userMemory";
import { rankUserMemory } from "../application/usecases/userMemorySearch";
import {
  DailyEvent,
  GetDailyEventsByDateInput,
  RememberDailyEventInput,
  SearchDailyEventsInput,
} from "../domain/dailyEvent";
import type {
  TurnRecordSearchItem,
  TurnRecordSearchRequest,
} from "./contracts";
import { ensureTurnRecordId } from "../domain/identifiers";
import {
  buildTurnExcerpt,
  buildTurnSearchText,
  cosineSimilarity,
} from "../application/usecases/turnSearchIndex";
import { join } from "node:path";
import {
  classifyTurnMemoryCandidates,
  TurnMemoryCandidate,
} from "../application/usecases/classifyTurnMemoryCandidates";

export interface MemorySystemOptions {
  postgresUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaAPIKey: string;
  ollamaEmbeddingBaseUrl?: string;
  ollamaEmbeddingModel?: string;
  ollamaEmbeddingDimension?: number;
  llmCacheDir?: string;
  llmCacheTtlMs?: number;
  chunkSizeTurns?: number;
  chunkOverlapTurns?: number;
  policyQueryHistoryTurns?: number;
  policyQueryHistoryMaxTokens?: number;
  agentInitiatedResponseMaxHours?: number;
  embeddingProvider?: TextEmbeddingClient;
}

export interface QueryPolicyInput {
  botId: string;
  threadId: string;
  currentContext: string;
  limit?: number;
}

export interface TurnMemoryProcessingResult {
  status: "processed" | "ignored";
  candidates: TurnMemoryCandidate[];
  userMemory: UserMemoryWriteResult[];
  dailyEvents: Array<{ action: "created" | "kept"; event: DailyEvent }>;
}

export interface PendingTurnMemoryBatchResult {
  selected: number;
  claimed: number;
  processed: number;
  failed: number;
}

export interface MemorySystemService {
  ingestTurnRecord(input: TurnRecord): Promise<void>;
  getRecentConversationContext(input: {
    botId: string;
    threadId: string;
    limit?: number;
    maxTokens?: number;
  }): Promise<string>;
  listThreadIds(botId: string, limit?: number): Promise<string[]>;
  buildConversationChunksForThread(
    botId: string,
    threadId: string,
    limit?: number,
  ): Promise<ConversationChunk[]>;
  listPendingConversationChunks(
    botId: string,
    limit?: number,
  ): Promise<ConversationChunk[]>;
  processPendingEpisodes(botId: string, limit?: number): Promise<EpisodeCase[]>;
  buildOrUpdatePolicyCards(
    botId: string,
    limit?: number,
  ): Promise<PolicyCard[]>;
  queryApplicablePolicyCards(input: QueryPolicyInput): Promise<PolicyCard[]>;
  search(input: MemorySearchRequest): Promise<MemorySearchResult>;
  inspectCatalog(input: MemoryCatalogRequest): Promise<MemoryCatalog>;
  rememberUserNote(input: {
    userId: string;
    note: string;
  }): Promise<UserMemoryWriteResult>;
  searchUserNotes(input: {
    userId: string;
    query: string;
    limit?: number;
  }): Promise<UserNote[]>;
  replaceUserNote(input: {
    userId: string;
    noteId: number;
    note: string;
  }): Promise<UserMemoryWriteResult>;
  deleteUserNote(input: { userId: string; noteId: number }): Promise<boolean>;
  backfillUserMemorySearchIndex(
    userId: string,
    limit?: number,
  ): Promise<number>;
  rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent>;
  searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]>;
  getDailyEventsByDate(input: GetDailyEventsByDateInput): Promise<DailyEvent[]>;
  searchRelatedTurns(
    input: TurnRecordSearchRequest,
  ): Promise<TurnRecordSearchItem[]>;
  backfillTurnSearchIndex(botId: string, limit?: number): Promise<number>;
  processTurnMemoryCandidates(input: {
    userId: string;
    turn: TurnRecord;
  }): Promise<TurnMemoryProcessingResult>;
  processPendingTurnMemories(input: {
    botId: string;
    userId: string;
    limit: number;
    concurrency: number;
    leaseMs?: number;
  }): Promise<PendingTurnMemoryBatchResult>;
}

class DefaultMemorySystemService implements MemorySystemService {
  private readonly llm: JsonGeneratingClient;
  private readonly repository: MemoryRepository;
  private readonly embedText?: (text: string) => Promise<number[]>;
  private readonly chunkingConfig: ChunkingConfig;
  private readonly policyQueryHistoryTurns: number;
  private readonly policyQueryHistoryMaxTokens: number;

  constructor(private readonly options: MemorySystemOptions) {
    this.llm = createFileCachedJsonClient(
      new OllamaClient(
        options.ollamaBaseUrl,
        options.ollamaModel,
        options.ollamaAPIKey,
      ),
      {
        cacheDir:
          options.llmCacheDir ??
          join(process.cwd(), "data", "memory-system", "llm-cache"),
        ttlMs: options.llmCacheTtlMs ?? 24 * 60 * 60 * 1000,
      },
    );
    this.repository = new MemoryRepository(options.postgresUrl);
    if (options.embeddingProvider) {
      this.embedText = (text: string) => options.embeddingProvider!.embed(text);
    } else if (options.ollamaEmbeddingModel) {
      const embeddingClient = new OllamaEmbeddingClient(
        options.ollamaEmbeddingBaseUrl ?? options.ollamaBaseUrl,
        options.ollamaEmbeddingModel,
        options.ollamaEmbeddingDimension,
        options.ollamaAPIKey,
      );
      this.embedText = (text: string) => embeddingClient.embed(text);
    }
    this.chunkingConfig = normalizeChunkingConfig({
      chunkSizeTurns: options.chunkSizeTurns,
      chunkOverlapTurns: options.chunkOverlapTurns,
      agentInitiatedResponseMaxHours: options.agentInitiatedResponseMaxHours,
    });
    this.policyQueryHistoryTurns = options.policyQueryHistoryTurns ?? 4;
    this.policyQueryHistoryMaxTokens =
      options.policyQueryHistoryMaxTokens ?? 1000;
  }

  async ingestTurnRecord(input: TurnRecord): Promise<void> {
    await this.repository.saveTurnRecord(input);
    if (this.embedText) {
      try {
        await this.indexTurnRecord(input);
      } catch {
        // The canonical TurnRecord remains available for a later backfill.
      }
    }
  }

  async getRecentConversationContext(input: {
    botId: string;
    threadId: string;
    limit?: number;
    maxTokens?: number;
  }): Promise<string> {
    const recentTurns = await this.repository.fetchRecentTurnRecordsForThread(
      input.botId,
      input.threadId,
      input.limit ?? this.policyQueryHistoryTurns,
    );
    return buildPolicyQueryContext(
      "",
      recentTurns,
      input.maxTokens ?? this.policyQueryHistoryMaxTokens,
    );
  }

  async listThreadIds(botId: string, limit: number = 100): Promise<string[]> {
    return this.repository.fetchThreadIdsForBot(botId, limit);
  }

  async buildConversationChunksForThread(
    botId: string,
    threadId: string,
    limit: number = 200,
  ): Promise<ConversationChunk[]> {
    const turnRecords = await this.repository.fetchTurnRecordsForThread(
      botId,
      threadId,
      limit,
    );
    console.log(
      "[buildConversationChunksForThread]: turnRecords.length=",
      turnRecords.length,
    );
    const chunks = buildConversationChunks(turnRecords, this.chunkingConfig);
    console.log(
      "[buildConversationChunksForThread]: chunks.length=",
      chunks.length,
    );
    await this.repository.saveConversationChunks(chunks);
    return chunks;
  }

  async listPendingConversationChunks(
    botId: string,
    limit: number = 20,
  ): Promise<ConversationChunk[]> {
    return this.repository.fetchPendingConversationChunks(botId, limit);
  }

  async processPendingEpisodes(
    botId: string,
    limit: number = 20,
  ): Promise<EpisodeCase[]> {
    const chunks = await this.repository.fetchPendingConversationChunks(
      botId,
      limit,
    );
    const episodes: EpisodeCase[] = [];
    for (const chunk of chunks) {
      const extracted = await extractEpisodeCasesFromChunk(
        this.llm,
        chunk,
        this.embedText,
      );
      for (const episode of extracted) {
        await this.repository.saveEpisodeCase(episode);
        episodes.push(episode);
      }
      await this.repository.markConversationChunkProcessed(chunk.id);
    }
    return episodes;
  }

  async buildOrUpdatePolicyCards(
    botId: string,
    limit: number = 20,
  ): Promise<PolicyCard[]> {
    console.log("[buildOrUpdatePolicyCards]: start");
    const episodes = await this.repository.fetchPendingEpisodes(botId, limit);
    if (episodes.length === 0) {
      return [];
    }

    const updatedCards: PolicyCard[] = [];
    console.log("[buildOrUpdatePolicyCards]: episodes.len=", episodes.length);
    for (const episode of episodes) {
      const existingCards = await this.repository.fetchPolicyCards(botId, 100);
      const episodeIds = existingCards.flatMap(
        (card) => card.episodeIds,
      );
      const relatedEpisodes = await this.repository.fetchEpisodesByIds(botId, [
        ...new Set(episodeIds),
      ]);
      const episodesByCardId = new Map<string, EpisodeCase[]>();
      for (const card of existingCards) {
        const related = relatedEpisodes.filter((candidate) =>
          card.episodeIds.includes(candidate.id),
        );
        episodesByCardId.set(card.id, related);
      }
      const card = await updatePolicyCardFromEpisode({
        llm: this.llm,
        botId,
        episode,
        existingCards,
        episodesByCardId,
        buildHypothesis: (evidence) =>
          buildPolicyHypothesisFromEpisodes(this.llm, evidence),
      });
      await this.repository.upsertPolicyCard(card);
      updatedCards.push(card);
      await this.repository.updateEpisodeRelatedCard(
        botId,
        card.episodeIds,
        card.id,
      );
      await this.repository.markEpisodeProcessed(episode.id);
    }
    console.log("[buildOrUpdatePolicyCards]: done");
    return updatedCards;
  }

  async queryApplicablePolicyCards(
    input: QueryPolicyInput,
  ): Promise<PolicyCard[]> {
    const recentTurns = await this.repository.fetchRecentTurnRecordsForThread(
      input.botId,
      input.threadId,
      this.policyQueryHistoryTurns,
    );
    const queryContext = buildPolicyQueryContext(
      input.currentContext,
      recentTurns,
      this.policyQueryHistoryMaxTokens,
    );
    const candidates = (
      await this.repository.fetchPolicyCards(input.botId, input.limit ?? 10)
    ).filter((card) => card.episodeIds.length > 0);
    return filterApplicablePolicyCards(this.llm, queryContext, candidates);
  }

  async search(input: MemorySearchRequest): Promise<MemorySearchResult> {
    const request = validateMemorySearchRequest(input);
    const result: MemorySearchResult = {};
    for (const scope of request.scopes) {
      if (scope === "conversation_history") {
        if (!this.embedText) {
          result.conversationHistory = {
            status: "unavailable",
            reason: "TurnRecord embedding provider is not configured",
          };
          continue;
        }
        try {
          const turns = await this.searchRelatedTurns({
            botId: request.botId,
            threadId: request.threadId,
            query: request.query,
            limit: request.limits?.conversation_history ?? 10,
          });
          result.conversationHistory = turns.length
            ? {
                status: "found",
                data: turns.map(({ turnRecordId, occurredAt, excerpt }) => ({
                  turnRecordId,
                  occurredAt,
                  excerpt,
                })),
              }
            : { status: "not_found" };
        } catch (error) {
          result.conversationHistory = {
            status: "unavailable",
            reason:
              error instanceof Error
                ? error.message
                : "TurnRecord search failed",
          };
        }
        continue;
      }
      if (scope === "policy_cards") {
        const cards = await this.queryApplicablePolicyCards({
          botId: request.botId,
          threadId: request.threadId,
          currentContext: request.query,
          limit: Math.min(request.limits?.policy_cards ?? 3, 3),
        });
        result.policyCards = cards.length
          ? {
              status: "found",
              data: cards.slice(0, 3).map((card) => ({
                policyCardId: card.id,
                appliesWhen: card.appliesWhen,
                recommendedBehavior: card.recommendedBehavior,
                ...(card.avoidBehavior
                  ? { avoidBehavior: card.avoidBehavior }
                  : {}),
              })),
            }
          : { status: "not_found" };
        continue;
      }
      if (scope !== "user_memory") {
        const unavailable = {
          status: "unavailable",
          reason: `${scope} search is not implemented`,
        } as const;
        result.dailyEvents = unavailable;
        continue;
      }
      if (!this.embedText) {
        result.userMemory = {
          status: "unavailable",
          reason: "UserMemory embedding provider is not configured",
        };
        continue;
      }
      try {
        const limit = request.limits?.user_memory ?? 5;
        const [rawQueryEmbedding, candidates] = await Promise.all([
          this.embedText(request.query),
          this.repository.fetchUserMemorySearchCandidates(
            request.userId,
            Math.max(limit * 10, 100),
          ),
        ]);
        const memories = rankUserMemory(
          request.query,
          requireEmbedding(rawQueryEmbedding),
          candidates,
        ).slice(0, limit);
        result.userMemory = memories.length
          ? {
              status: "found",
              data: memories.map(({ id, note }) => ({ noteId: id, note })),
            }
          : { status: "not_found" };
      } catch (error) {
        result.userMemory = {
          status: "unavailable",
          reason:
            error instanceof Error ? error.message : "UserMemory search failed",
        };
      }
    }
    return result;
  }

  async inspectCatalog(input: MemoryCatalogRequest): Promise<MemoryCatalog> {
    const [conversationHistory, userMemory, dailyEvents, policyCards] =
      await Promise.all([
        catalogEntry(async () => {
          const turns = await this.repository.fetchRecentTurnRecordsForThread(
            input.botId,
            input.threadId,
            CATALOG_SOURCE_LIMIT,
          );
          return {
            topics: turns.flatMap((turn) =>
              turn.messages
                .filter((message) => message.role !== "system")
                .map((message) => message.content),
            ),
            updatedAt: latestIso(turns.map((turn) => turn.createdAtIso)),
          };
        }),
        catalogEntry(async () => {
          const notes = await this.repository.searchUserNotes(
            input.userId,
            "",
            CATALOG_SOURCE_LIMIT,
          );
          return {
            topics: notes.map((note) => note.note),
            updatedAt: latestIso(
              notes.map((note) => note.createdAt.toISOString()),
            ),
          };
        }),
        catalogEntry(async () => {
          const [events, dateRange] = await Promise.all([
            this.repository.searchDailyEvents({
              userId: input.userId,
              query: "",
              limit: CATALOG_SOURCE_LIMIT,
            }),
            this.repository.getDailyEventDateRange(input.userId),
          ]);
          return {
            topics: events.map((event) => event.summary),
            updatedAt: latestIso(
              events.map((event) => event.createdAt.toISOString()),
            ),
            dateRange,
          };
        }),
        catalogEntry(async () => {
          const cards = await this.repository.fetchPolicyCards(
            input.botId,
            CATALOG_SOURCE_LIMIT,
          );
          return {
            topics: cards.map((card) => card.appliesWhen),
            updatedAt: latestIso(cards.map((card) => card.lastUpdatedIso)),
          };
        }),
      ]);
    const entries = [conversationHistory, userMemory, dailyEvents, policyCards];
    return {
      status: entries.every((entry) => entry.status === "unavailable")
        ? "unavailable"
        : "available",
      conversationHistory,
      userMemory,
      dailyEvents,
      policyCards,
    };
  }

  async processTurnMemoryCandidates(input: {
    userId: string;
    turn: TurnRecord;
  }): Promise<TurnMemoryProcessingResult> {
    if (input.turn.kind !== "human") {
      return {
        status: "ignored",
        candidates: [],
        userMemory: [],
        dailyEvents: [],
      };
    }
    const candidates = await classifyTurnMemoryCandidates(this.llm, input.turn);
    const userMemory: UserMemoryWriteResult[] = [];
    const dailyEvents: Array<{
      action: "created" | "kept";
      event: DailyEvent;
    }> = [];
    for (const candidate of candidates) {
      if (candidate.kind === "user_memory") {
        userMemory.push(
          await this.executeUserMemoryWrite(input.userId, candidate.note),
        );
        continue;
      }
      const existing = await this.repository.searchDailyEvents({
        userId: input.userId,
        query: candidate.summary,
        from: candidate.eventDate,
        to: candidate.eventDate,
        limit: 20,
      });
      const duplicate = existing.find(
        (event) =>
          event.eventDate === candidate.eventDate &&
          normalizeMemoryText(event.summary) ===
            normalizeMemoryText(candidate.summary),
      );
      if (duplicate) {
        dailyEvents.push({ action: "kept", event: duplicate });
        continue;
      }
      dailyEvents.push({
        action: "created",
        event: await this.repository.rememberDailyEvent({
          userId: input.userId,
          eventDate: candidate.eventDate,
          summary: candidate.summary,
        }),
      });
    }
    return { status: "processed", candidates, userMemory, dailyEvents };
  }

  async processPendingTurnMemories(input: {
    botId: string;
    userId: string;
    limit: number;
    concurrency: number;
    leaseMs?: number;
  }): Promise<PendingTurnMemoryBatchResult> {
    const limit = Math.max(1, Math.floor(input.limit));
    const concurrency = Math.max(1, Math.min(limit, Math.floor(input.concurrency)));
    const leaseMs = Math.max(1_000, input.leaseMs ?? 5 * 60 * 1_000);
    const batchStartedAt = new Date();
    const selected = await this.repository.fetchPendingTurnMemoryRecords(
      input.botId,
      limit,
      batchStartedAt,
    );
    const result: PendingTurnMemoryBatchResult = {
      selected: selected.length,
      claimed: 0,
      processed: 0,
      failed: 0,
    };
    await mapWithConcurrency(selected, concurrency, async (turn) => {
      const record = ensureTurnRecordId(turn);
      const claimed = await this.repository.claimTurnMemoryRecord(
        record.id,
        new Date(batchStartedAt.getTime() + leaseMs),
        batchStartedAt,
      );
      if (!claimed) return;
      result.claimed += 1;
      try {
        await this.processTurnMemoryCandidates({ userId: input.userId, turn: record });
        await this.repository.completeTurnMemoryRecord(record.id, new Date());
        result.processed += 1;
      } catch (error) {
        result.failed += 1;
        await this.repository.releaseTurnMemoryRecord(record.id);
        const detail = error instanceof Error ? error.message : String(error);
        process.stdout.write(
          `[memory-candidate-error] turnRecordId=${record.id} detail=${detail}\n`,
        );
      }
    });
    return result;
  }

  async rememberUserNote(input: {
    userId: string;
    note: string;
  }): Promise<UserMemoryWriteResult> {
    return this.executeUserMemoryWrite(input.userId, input.note);
  }

  async searchUserNotes(input: {
    userId: string;
    query: string;
    limit?: number;
  }): Promise<UserNote[]> {
    return this.repository.searchUserNotes(
      input.userId,
      input.query,
      input.limit ?? 5,
    );
  }

  async replaceUserNote(input: {
    userId: string;
    noteId: number;
    note: string;
  }): Promise<UserMemoryWriteResult> {
    return this.executeUserMemoryWrite(input.userId, input.note, input.noteId);
  }

  async deleteUserNote(input: {
    userId: string;
    noteId: number;
  }): Promise<boolean> {
    const deleted = await this.repository.deleteUserNote(
      input.userId,
      input.noteId,
    );
    if (deleted) await this.deleteUserMemorySearchIndexBestEffort(input.noteId);
    return deleted;
  }

  async backfillUserMemorySearchIndex(
    userId: string,
    limit: number = 100,
  ): Promise<number> {
    if (!this.embedText) return 0;
    const notes = await this.repository.fetchUnindexedUserNotes(userId, limit);
    let indexed = 0;
    for (const note of notes) {
      try {
        await this.indexUserNote(userId, note);
        indexed += 1;
      } catch {
        // The canonical note remains available and unindexed for a later retry.
      }
    }
    return indexed;
  }

  private async executeUserMemoryWrite(
    userId: string,
    proposedNote: string,
    explicitTargetNoteId?: number,
  ): Promise<UserMemoryWriteResult> {
    const [partialMatches, recentNotes, semanticMatches] = await Promise.all([
      this.repository.searchUserNotes(userId, proposedNote.trim(), 12),
      this.repository.searchUserNotes(userId, "", 24),
      this.findSemanticUserNotes(userId, proposedNote, 12),
    ]);
    const candidates = mergeUserNoteCandidates(
      [...semanticMatches, ...partialMatches],
      recentNotes,
      explicitTargetNoteId,
    );
    if (
      explicitTargetNoteId !== undefined &&
      !candidates.some((candidate) => candidate.id === explicitTargetNoteId)
    ) {
      return {
        ok: false,
        error: "The requested UserMemory note ID was not found.",
      };
    }
    const decision = await decideUserMemoryWrite(this.llm, {
      proposedNote,
      candidates,
      ...(explicitTargetNoteId !== undefined ? { explicitTargetNoteId } : {}),
    });
    if (!decision) {
      return { ok: false, error: "UserMemory write decision was invalid." };
    }
    if (decision.destination !== "user_memory") {
      return rejectedMemoryDestination(decision.destination, decision.reason);
    }
    if (decision.action === "create") {
      const note = await this.repository.rememberUserNote(userId, proposedNote);
      await this.indexUserNoteBestEffort(userId, note);
      return { ok: true, action: decision.action, reason: decision.reason, note };
    }
    const target = candidates.find(
      (candidate) => candidate.id === decision.targetNoteId,
    );
    if (!target) {
      return { ok: false, error: "UserMemory write target was not found." };
    }
    if (decision.action === "keep_existing") {
      await this.indexUserNoteBestEffort(userId, target);
      return {
        ok: true,
        action: decision.action,
        reason: decision.reason,
        note: target,
      };
    }
    if (decision.action === "replace") {
      const note = await this.repository.replaceUserNote(
        userId,
        target.id,
        proposedNote,
      );
      await this.deleteUserMemorySearchIndexBestEffort(target.id);
      if (note) await this.indexUserNoteBestEffort(userId, note);
      return {
        ok: note !== null,
        action: decision.action,
        reason: decision.reason,
        note,
      };
    }
    const deleted = await this.repository.deleteUserNote(userId, target.id);
    if (deleted) await this.deleteUserMemorySearchIndexBestEffort(target.id);
    return {
      ok: deleted,
      action: decision.action,
      reason: decision.reason,
      deletedNoteId: target.id,
    };
  }

  private async findSemanticUserNotes(
    userId: string,
    query: string,
    limit: number,
  ): Promise<UserNote[]> {
    if (!this.embedText) return [];
    try {
      const [embedding, candidates] = await Promise.all([
        this.embedText(query),
        this.repository.fetchUserMemorySearchCandidates(
          userId,
          Math.max(limit * 10, 100),
        ),
      ]);
      return rankUserMemory(query, requireEmbedding(embedding), candidates)
        .slice(0, limit)
        .map(({ id, note, createdAt }) => ({ id, note, createdAt }));
    } catch {
      return [];
    }
  }

  private async indexUserNote(userId: string, note: UserNote): Promise<void> {
    if (!this.embedText) return;
    const embedding = requireEmbedding(await this.embedText(note.note));
    await this.repository.upsertUserMemorySearchIndex({
      noteId: note.id,
      userId,
      note: note.note,
      embedding,
    });
  }

  private async indexUserNoteBestEffort(
    userId: string,
    note: UserNote,
  ): Promise<void> {
    try {
      await this.indexUserNote(userId, note);
    } catch {
      // Search indexing is rebuildable and must not make the canonical write fail.
    }
  }

  private async deleteUserMemorySearchIndexBestEffort(
    noteId: number,
  ): Promise<void> {
    try {
      await this.repository.deleteUserMemorySearchIndex(noteId);
    } catch {
      // Stale index rows cannot surface after canonical deletion because reads join notes.
    }
  }

  async rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent> {
    return this.repository.rememberDailyEvent(input);
  }

  async searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]> {
    return this.repository.searchDailyEvents(input);
  }

  async getDailyEventsByDate(
    input: GetDailyEventsByDateInput,
  ): Promise<DailyEvent[]> {
    return this.repository.getDailyEventsByDate(input);
  }

  async searchRelatedTurns(
    input: TurnRecordSearchRequest,
  ): Promise<TurnRecordSearchItem[]> {
    if (!this.embedText || input.query.trim().length === 0) return [];
    const queryEmbedding = await this.embedText(input.query);
    const candidates = await this.repository.fetchTurnSearchCandidates(
      input,
      Math.max(input.limit ?? 10, 100),
    );
    return candidates
      .map((candidate) => ({
        turnRecordId: candidate.turnRecordId,
        occurredAt: candidate.occurredAtIso,
        excerpt: candidate.excerpt,
        score:
          cosineSimilarity(queryEmbedding, candidate.embedding) *
          (candidate.kind === "human" ? 1 : 0.85),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 10)
      .map(({ turnRecordId, occurredAt, excerpt }) => ({
        turnRecordId,
        occurredAt,
        excerpt,
      }));
  }

  async backfillTurnSearchIndex(
    botId: string,
    limit: number = 100,
  ): Promise<number> {
    if (!this.embedText) return 0;
    const records = await this.repository.fetchUnindexedTurnRecords(
      botId,
      limit,
    );
    let indexed = 0;
    for (const record of records) {
      try {
        await this.indexTurnRecord(record);
        indexed += 1;
      } catch {
        // Failed rows stay unindexed so the next backfill can retry them.
      }
    }
    return indexed;
  }

  private async indexTurnRecord(input: TurnRecord): Promise<void> {
    if (!this.embedText) return;
    const record = ensureTurnRecordId(input);
    const embedding = await this.embedText(buildTurnSearchText(record));
    await this.repository.upsertTurnSearchIndex({
      turnRecordId: record.id,
      botId: record.botId,
      threadId: record.threadId,
      kind: record.kind,
      roles: [...new Set(record.messages.map((message) => message.role))],
      occurredAtIso: record.createdAtIso,
      excerpt: buildTurnExcerpt(record),
      embedding,
    });
  }
}

const mergeUserNoteCandidates = (
  partialMatches: UserNote[],
  recentNotes: UserNote[],
  explicitTargetNoteId?: number,
): UserNote[] => {
  const ordered = [...partialMatches, ...recentNotes];
  const unique = ordered.filter(
    (candidate, index) =>
      ordered.findIndex((item) => item.id === candidate.id) === index,
  );
  if (explicitTargetNoteId === undefined) return unique.slice(0, 24);
  const explicit = unique.find(
    (candidate) => candidate.id === explicitTargetNoteId,
  );
  return explicit
    ? [
        explicit,
        ...unique.filter((candidate) => candidate.id !== explicit.id),
      ].slice(0, 24)
    : unique.slice(0, 24);
};

const rejectedMemoryDestination = (
  destination: "daily_event" | "topic_state" | "reject",
  reason: string,
): UserMemoryWriteResult => {
  const errors = {
    daily_event:
      "Use remember_daily_event with an explicit eventDate; content is not stored automatically.",
    topic_state:
      "TopicState is updated only by the proactive reaction observation path.",
    reject: "Content is not suitable for automatic memory storage.",
  } as const;
  return { ok: false, destination, reason, error: errors[destination] };
};

const requireEmbedding = (embedding: number[]): number[] => {
  if (
    embedding.length === 0 ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Embedding provider returned an invalid vector");
  }
  return embedding;
};

const CATALOG_SOURCE_LIMIT = 100;
const CATALOG_TOPIC_LIMIT = 5;
const CATALOG_TOPIC_MAX_LENGTH = 80;

const catalogEntry = async (load: () => Promise<{
  topics: string[];
  updatedAt?: string;
  dateRange?: { from?: string; to?: string };
}>): Promise<MemoryCatalogEntry> => {
  try {
    const loaded = await load();
    const topics = [
      ...new Set(loaded.topics.map(formatCatalogTopic).filter(Boolean)),
    ].slice(0, CATALOG_TOPIC_LIMIT);
    if (topics.length === 0) {
      return { status: "empty", available: false, topics: [] };
    }
    return {
      status: "available",
      available: true,
      topics,
      ...(loaded.updatedAt ? { updatedAt: loaded.updatedAt } : {}),
      ...(loaded.dateRange ? { dateRange: loaded.dateRange } : {}),
    };
  } catch (error) {
    return {
      status: "unavailable",
      available: false,
      topics: [],
      reason: error instanceof Error ? error.message : "Catalog backend failed",
    };
  }
};

const formatCatalogTopic = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= CATALOG_TOPIC_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, CATALOG_TOPIC_MAX_LENGTH - 1)}…`;
};

const latestIso = (values: string[]): string | undefined =>
  values.filter(Boolean).sort().at(-1);

const normalizeMemoryText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const mapWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  process: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await process(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
};

export const createMemorySystemService = (
  options: MemorySystemOptions,
): MemorySystemService => {
  return new DefaultMemorySystemService(options);
};
