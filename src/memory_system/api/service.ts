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
import { OllamaEmbeddingClient } from "../infrastructure/ollama/embeddingClient";
import { OllamaClient } from "../infrastructure/ollama/client";
import {
  createFileCachedJsonClient,
  JsonGeneratingClient,
} from "../infrastructure/ollama/fileCachedClient";
import { MemoryRepository } from "../infrastructure/postgres/repository";
import {
  UserMemoryWriteResult,
  UserNote,
  decideUserMemoryWrite,
} from "../domain/userMemory";
import { join } from "node:path";

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
}

export interface QueryPolicyInput {
  botId: string;
  threadId: string;
  currentContext: string;
  limit?: number;
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
    if (options.ollamaEmbeddingModel) {
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
    return this.repository.deleteUserNote(input.userId, input.noteId);
  }

  private async executeUserMemoryWrite(
    userId: string,
    proposedNote: string,
    explicitTargetNoteId?: number,
  ): Promise<UserMemoryWriteResult> {
    const [partialMatches, recentNotes] = await Promise.all([
      this.repository.searchUserNotes(userId, proposedNote.trim(), 12),
      this.repository.searchUserNotes(userId, "", 24),
    ]);
    const candidates = mergeUserNoteCandidates(
      partialMatches,
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
      return { ok: true, action: decision.action, reason: decision.reason, note };
    }
    const target = candidates.find(
      (candidate) => candidate.id === decision.targetNoteId,
    );
    if (!target) {
      return { ok: false, error: "UserMemory write target was not found." };
    }
    if (decision.action === "keep_existing") {
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
      return {
        ok: note !== null,
        action: decision.action,
        reason: decision.reason,
        note,
      };
    }
    const deleted = await this.repository.deleteUserNote(userId, target.id);
    return {
      ok: deleted,
      action: decision.action,
      reason: decision.reason,
      deletedNoteId: target.id,
    };
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

export const createMemorySystemService = (
  options: MemorySystemOptions,
): MemorySystemService => {
  return new DefaultMemorySystemService(options);
};
