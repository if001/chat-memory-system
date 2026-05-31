import {
  ChunkingConfig,
  ConversationChunk,
  EpisodeCase,
  MemoryReport,
  PolicyCard,
  PolicySplitCandidate,
  TurnRecord,
} from "../domain/types";
import { buildPolicyCardFromEpisodes } from "../application/usecases/buildPolicyCard";
import {
  buildConversationChunks,
  normalizeChunkingConfig,
} from "../application/usecases/buildConversationChunks";
import { buildPolicyQueryContext } from "../application/usecases/buildPolicyQueryContext";
import { mergePolicyCardUpdate } from "../application/usecases/mergePolicyCardUpdate";
import { applyResolvedSplitCandidate } from "../application/usecases/applyResolvedSplitCandidate";
import { decidePolicyCardUpdate } from "../application/usecases/decidePolicyCardUpdate";
import { extractEpisodeCaseFromChunk } from "../application/usecases/extractEpisodeCase";
import { filterApplicablePolicyCards } from "../application/usecases/filterApplicablePolicyCards";
import { transitionPolicySplitCandidate } from "../application/usecases/transitionPolicySplitCandidate";
import { buildSplitCandidateId } from "../domain/identifiers";
import { OllamaClient } from "../infrastructure/ollama/client";
import { MemoryRepository } from "../infrastructure/postgres/repository";

export interface MemorySystemOptions {
  postgresUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaAPIKey: string;
  chunkSizeTurns?: number;
  chunkOverlapTurns?: number;
  policyQueryHistoryTurns?: number;
  policyQueryHistoryMaxTokens?: number;
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
  listOpenSplitCandidates(
    botId: string,
    limit?: number,
  ): Promise<PolicySplitCandidate[]>;
  resolveSplitCandidate(
    botId: string,
    candidateId: string,
  ): Promise<PolicySplitCandidate | null>;
  ignoreSplitCandidate(
    botId: string,
    candidateId: string,
  ): Promise<PolicySplitCandidate | null>;
  queryApplicablePolicyCards(input: QueryPolicyInput): Promise<PolicyCard[]>;
  generateMemoryReport(botId: string, threadId: string): Promise<MemoryReport>;
}

class DefaultMemorySystemService implements MemorySystemService {
  private readonly llm: OllamaClient;
  private readonly repository: MemoryRepository;
  private readonly chunkingConfig: ChunkingConfig;
  private readonly policyQueryHistoryTurns: number;
  private readonly policyQueryHistoryMaxTokens: number;

  constructor(private readonly options: MemorySystemOptions) {
    this.llm = new OllamaClient(
      options.ollamaBaseUrl,
      options.ollamaModel,
      options.ollamaAPIKey,
    );
    this.repository = new MemoryRepository(options.postgresUrl);
    this.chunkingConfig = normalizeChunkingConfig({
      chunkSizeTurns: options.chunkSizeTurns,
      chunkOverlapTurns: options.chunkOverlapTurns,
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
    const chunks = buildConversationChunks(turnRecords, this.chunkingConfig);
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
      const episode = await extractEpisodeCaseFromChunk(this.llm, chunk);
      await this.repository.saveEpisodeCase(episode);
      await this.repository.markConversationChunkProcessed(chunk.id);
      episodes.push(episode);
    }

    return episodes;
  }

  async buildOrUpdatePolicyCards(
    botId: string,
    limit: number = 20,
  ): Promise<PolicyCard[]> {
    const episodes = await this.repository.fetchPendingEpisodes(botId, limit);
    if (episodes.length === 0) {
      return [];
    }
    const updatedCards: PolicyCard[] = [];
    let existingCards = await this.repository.fetchPolicyCards(botId, 50);

    for (const episode of episodes) {
      const decision = await decidePolicyCardUpdate(
        this.llm,
        episode,
        existingCards,
      );
      const card = await this.applyPolicyDecision(
        botId,
        episode,
        decision,
        existingCards,
      );
      await this.repository.markEpisodeProcessed(episode.id);
      if (!card) {
        continue;
      }
      updatedCards.push(card);
      existingCards = replaceCard(existingCards, card);
    }

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
    const candidates = await this.repository.fetchPolicyCards(
      input.botId,
      input.limit ?? 10,
    );
    return filterApplicablePolicyCards(this.llm, queryContext, candidates);
  }

  async listOpenSplitCandidates(
    botId: string,
    limit: number = 20,
  ): Promise<PolicySplitCandidate[]> {
    return this.repository.fetchOpenSplitCandidates(botId, limit);
  }

  async resolveSplitCandidate(
    botId: string,
    candidateId: string,
  ): Promise<PolicySplitCandidate | null> {
    return this.transitionSplitCandidate(botId, candidateId, "resolved");
  }

  async ignoreSplitCandidate(
    botId: string,
    candidateId: string,
  ): Promise<PolicySplitCandidate | null> {
    return this.transitionSplitCandidate(botId, candidateId, "ignored");
  }

  async generateMemoryReport(
    botId: string,
    threadId: string,
  ): Promise<MemoryReport> {
    const cards = await this.repository.fetchPolicyCards(botId, 20);
    const signals = buildMemoryReportSignals(cards, new Date());
    return this.repository.createMemoryReport(
      botId,
      threadId,
      signals.gaps,
      signals.staleNotes,
      signals.conflicts,
    );
  }

  private async applyPolicyDecision(
    botId: string,
    episode: EpisodeCase,
    decision: Awaited<ReturnType<typeof decidePolicyCardUpdate>>,
    existingCards: PolicyCard[],
  ): Promise<PolicyCard | null> {
    if (decision.decision === "merge" && decision.targetPolicyCardId) {
      const existing = existingCards.find(
        (card) => card.id === decision.targetPolicyCardId,
      );
      if (existing && decision.updatedPolicyCard) {
        const updatedCard = mergePolicyCardUpdate(
          existing,
          decision.updatedPolicyCard,
          episode,
        );
        await this.repository.upsertPolicyCard(updatedCard);
        return updatedCard;
      }
    }

    if (decision.decision === "split_existing") {
      await this.repository.savePolicySplitCandidate({
        id: buildSplitCandidateId(episode.id, decision.targetPolicyCardId),
        botId,
        episodeId: episode.id,
        targetPolicyCardId: decision.targetPolicyCardId,
        reason: decision.reason,
        status: "open",
        createdAtIso: new Date().toISOString(),
      });
    }

    const createdCard = await buildPolicyCardFromEpisodes(this.llm, botId, [
      episode,
    ]);
    if (!createdCard) {
      return null;
    }
    await this.repository.upsertPolicyCard(createdCard);
    return createdCard;
  }

  private async transitionSplitCandidate(
    botId: string,
    candidateId: string,
    nextStatus: "resolved" | "ignored",
  ): Promise<PolicySplitCandidate | null> {
    const existing = await this.repository.fetchPolicySplitCandidateById(
      botId,
      candidateId,
    );
    if (!existing) {
      return null;
    }
    const updated = transitionPolicySplitCandidate(existing, nextStatus);
    await this.repository.updatePolicySplitCandidateStatus(
      botId,
      candidateId,
      updated.status,
    );
    if (nextStatus === "resolved") {
      await this.applyResolvedSplitCandidate(botId, updated);
    }
    return updated;
  }

  private async applyResolvedSplitCandidate(
    botId: string,
    candidate: PolicySplitCandidate,
  ): Promise<void> {
    if (!candidate.targetPolicyCardId) {
      return;
    }
    const [episode, targetCard] = await Promise.all([
      this.repository.fetchEpisodeById(botId, candidate.episodeId),
      this.repository.fetchPolicyCardById(botId, candidate.targetPolicyCardId),
    ]);
    if (!episode || !targetCard) {
      return;
    }
    const updatedCard = applyResolvedSplitCandidate(
      targetCard,
      episode,
      candidate,
    );
    await this.repository.upsertPolicyCard(updatedCard);
  }
}

export const createMemorySystemService = (
  options: MemorySystemOptions,
): MemorySystemService => {
  return new DefaultMemorySystemService(options);
};

export const buildMemoryReportSignals = (
  cards: PolicyCard[],
  now: Date,
): Pick<MemoryReport, "gaps" | "staleNotes" | "conflicts"> => {
  const gaps: string[] = [];
  const staleNotes: string[] = [];
  const conflicts: string[] = [];

  if (cards.length === 0) {
    gaps.push("No policy cards exist yet for this bot");
  }

  const highConfidenceCount = cards.filter(
    (card) => card.confidence === "high",
  ).length;
  if (cards.length > 0 && highConfidenceCount === 0) {
    gaps.push("No high-confidence policy card exists");
  }

  const staleThresholdMs = 30 * 24 * 60 * 60 * 1000;
  for (const card of cards) {
    const ageMs = now.getTime() - new Date(card.lastUpdatedIso).getTime();
    if (ageMs > staleThresholdMs) {
      staleNotes.push(`Policy card is stale: ${card.id}`);
    }
  }

  const byTitle = new Map<string, PolicyCard[]>();
  for (const card of cards) {
    const key = card.title.trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), card]);
  }
  for (const [key, group] of byTitle.entries()) {
    if (group.length < 2) {
      continue;
    }
    const behaviors = new Set(
      group.map((card) => card.recommendedBehavior.trim().toLowerCase()),
    );
    if (behaviors.size > 1) {
      conflicts.push(
        `Conflicting recommended behavior detected for title: ${key}`,
      );
    }
  }

  return { gaps, staleNotes, conflicts };
};

const replaceCard = (
  cards: PolicyCard[],
  updated: PolicyCard,
): PolicyCard[] => {
  const remaining = cards.filter((card) => card.id !== updated.id);
  return [updated, ...remaining];
};
