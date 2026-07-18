import {
  ChunkingConfig,
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  PolicyEvaluation,
  PolicyHypothesis,
  RelationshipInsightReport,
  TurnRecord,
} from "../domain/types";
import { buildPolicyHypothesisFromEpisodes } from "../application/usecases/buildPolicyCard";
import {
  applyEpisodeToPolicyCardFlow,
  createPolicyCardFlowCache,
  PolicyCardFlowPorts,
} from "../application/usecases/policyCardFlow";
import {
  buildConversationChunks,
  normalizeChunkingConfig,
} from "../application/usecases/buildConversationChunks";
import { buildPolicyQueryContext } from "../application/usecases/buildPolicyQueryContext";
import { extractEpisodeCasesFromChunk } from "../application/usecases/extractEpisodeCase";
import { filterApplicablePolicyCards } from "../application/usecases/filterApplicablePolicyCards";
import { OllamaEmbeddingClient } from "../infrastructure/ollama/embeddingClient";
import { OllamaClient } from "../infrastructure/ollama/client";
import {
  createFileCachedJsonClient,
  JsonGeneratingClient,
} from "../infrastructure/ollama/fileCachedClient";
import { MemoryRepository } from "../infrastructure/postgres/repository";
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
  policySearchLimit?: number;
  policyFlowPorts?: Partial<PolicyCardFlowPorts>;
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
  generateRelationshipInsightReport(
    botId: string,
    threadId: string,
  ): Promise<RelationshipInsightReport>;
}

class DefaultMemorySystemService implements MemorySystemService {
  private readonly llm: JsonGeneratingClient;
  private readonly repository: MemoryRepository;
  private readonly embedText?: (text: string) => Promise<number[]>;
  private readonly chunkingConfig: ChunkingConfig;
  private readonly policyQueryHistoryTurns: number;
  private readonly policyQueryHistoryMaxTokens: number;
  private readonly policySearchLimit: number;
  private readonly policyFlowPorts: PolicyCardFlowPorts;

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
    });
    this.policyQueryHistoryTurns = options.policyQueryHistoryTurns ?? 4;
    this.policyQueryHistoryMaxTokens =
      options.policyQueryHistoryMaxTokens ?? 1000;
    this.policySearchLimit = options.policySearchLimit ?? 5;
    this.policyFlowPorts = buildDefaultPolicyFlowPorts(
      this.llm,
      this.embedText,
      options,
    );
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
    const cache = createPolicyCardFlowCache();
    console.log("[buildOrUpdatePolicyCards]: episodes.len=", episodes.length);
    for (const episode of episodes) {
      const existingCards = await this.repository.fetchPolicyCards(botId, 100);
      const episodeIds = existingCards.flatMap(
        (card) => card.relatedEpisodeIds,
      );
      const relatedEpisodes = await this.repository.fetchEpisodesByIds(botId, [
        ...new Set(episodeIds),
      ]);
      const episodesByCardId = new Map<string, EpisodeCase[]>();
      for (const card of existingCards) {
        const related = relatedEpisodes.filter((candidate) =>
          card.relatedEpisodeIds.includes(candidate.id),
        );
        episodesByCardId.set(card.id, related);
      }
      const unassignedEpisodes = (
        await this.repository.fetchUnassignedEpisodes(botId, 200)
      ).filter((candidate) => candidate.id !== episode.id);

      const result = await applyEpisodeToPolicyCardFlow({
        botId,
        newEpisode: episode,
        existingCards,
        episodesByCardId,
        unassignedEpisodes,
        searchLimit: this.policySearchLimit,
        ports: this.policyFlowPorts,
        cache,
      });

      for (const card of result.updatedCards) {
        await this.repository.upsertPolicyCard(card);
        updatedCards.push(card);
      }

      if (result.outcome === "merged" || result.outcome === "created") {
        await this.repository.updateEpisodeRelatedCard(
          botId,
          result.assignedEpisodeIds,
          result.updatedCards[0]?.id,
        );
      }

      if (result.outcome === "split") {
        const [updatedOriginalCard, createdCard] = result.updatedCards;
        const newCardEpisodeIds = createdCard.relatedEpisodeIds;
        const originalEpisodeIds = updatedOriginalCard.relatedEpisodeIds;
        await Promise.all([
          this.repository.updateEpisodeRelatedCard(
            botId,
            newCardEpisodeIds,
            createdCard.id,
          ),
          this.repository.updateEpisodeRelatedCard(
            botId,
            originalEpisodeIds,
            updatedOriginalCard.id,
          ),
        ]);
      }

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
    const candidates = await this.repository.fetchPolicyCards(
      input.botId,
      input.limit ?? 10,
    );
    return filterApplicablePolicyCards(this.llm, queryContext, candidates);
  }

  async generateRelationshipInsightReport(
    botId: string,
    threadId: string,
  ): Promise<RelationshipInsightReport> {
    const recentContext = await this.getRecentConversationContext({
      botId,
      threadId,
      limit: Math.max(this.policyQueryHistoryTurns, 6),
      maxTokens: Math.max(this.policyQueryHistoryMaxTokens, 1200),
    });
    const cards = await this.repository.fetchPolicyCards(botId, 8);
    if (!recentContext.trim() && cards.length === 0) {
      return {
        botId,
        threadId,
        clarificationCandidates: [],
        proactiveContextCandidates: [],
        repairCandidates: [],
        boundaryCandidates: [],
        createdAtIso: new Date().toISOString(),
      };
    }

    const parsed = await this.llm.generateJson<{
      clarificationCandidates?: string[];
      proactiveContextCandidates?: string[];
      repairCandidates?: string[];
      boundaryCandidates?: string[];
    }>(
      [
        "あなたは autonomous assistant 向けの relationship-support insight candidate を作成します。",
        "recentConversationContext と policyCards を読み、ユーザー支援候補を提案してください。",
        "JSON のみを返してください。",
      ].join(" "),
      JSON.stringify({
        recentConversationContext: recentContext,
        policyCards: cards.map((card) => ({
          state: card.state,
          action: card.action,
          outcome: card.outcome,
        })),
      }),
    );

    return {
      botId,
      threadId,
      clarificationCandidates: normalizeCandidateList(
        parsed.clarificationCandidates,
      ),
      proactiveContextCandidates: normalizeCandidateList(
        parsed.proactiveContextCandidates,
      ),
      repairCandidates: normalizeCandidateList(parsed.repairCandidates),
      boundaryCandidates: normalizeCandidateList(parsed.boundaryCandidates),
      createdAtIso: new Date().toISOString(),
    };
  }
}

export const createMemorySystemService = (
  options: MemorySystemOptions,
): MemorySystemService => {
  return new DefaultMemorySystemService(options);
};

const normalizeCandidateList = (values: string[] | undefined): string[] =>
  (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);

const buildDefaultPolicyFlowPorts = (
  llm: JsonGeneratingClient,
  embedText: ((text: string) => Promise<number[]>) | undefined,
  options: MemorySystemOptions,
): PolicyCardFlowPorts => {
  const defaultPorts: PolicyCardFlowPorts = {
    buildHypothesis: async (episodes) =>
      buildPolicyHypothesisFromEpisodes(llm, episodes, embedText),
    searchCards: async (hypothesis, cards, limit) =>
      rankCardsBySimilarity(hypothesis, cards).slice(0, limit),
    evaluateEpisodes: async (episodes) => {
      console.log("[evaluateEpisodes]: call llm");
      return llm.generateJson<PolicyEvaluation>(
        [
          "あなたは policy evaluation judge です。",
          "Episode 群が 1 つの Policy として一貫しているかを判定してください。",
          "consistent: このEpisode群は、提示されたstateの具体例であり、提示されたactionの具体的実行であり、outcomeも同じ種類の変化として説明できるか。"
          "clear: このPolicyは、状態を観測したAgentが、取るべき手順を迷わず選べる記述になっているか。"
          "JSON のみを返してください。",
        ].join(" "),
        JSON.stringify({
          instruction:
            "consistent と clear を boolean で返してください。Episode 群が同じ state/action/outcome の具体例なら consistent=true、state から action を迷わず選べるなら clear=true です。",
          episodes,
        }),
      );
    },
    evaluateSplit: async (groupA, groupB) => {
      console.log("[evaluateSplit]: call llm");
      return llm.generateJson<PolicyEvaluation>(
        [
          "あなたは policy split evaluation judge です。",
          "2 つの Episode 群を別 Policy に分けるべきかを判定してください。",
          "consistent: このEpisode群は、提示されたstateの具体例であり、提示されたactionの具体的実行であり、outcomeも同じ種類の変化として説明できるか。"
          "clear: このPolicyは、状態を観測したAgentが、取るべき手順を迷わず選べる記述になっているか。"
          "JSON のみを返してください。",
        ].join(" "),
        JSON.stringify({
          instruction:
            "consistent と clear を boolean で返してください。両グループが個別に一貫していて、相互の違いが state/action/outcome で説明できるなら consistent=true、両 Policy が重複せず明確なら clear=true です。",
          groupA,
          groupB,
        }),
      );
    },
    clusterByState: async (episodes, newEpisode) =>
      buildSimilarityClusters(episodes, newEpisode, "state"),
    clusterByAction: async (episodes, newEpisode) =>
      buildSimilarityClusters(episodes, newEpisode, "action"),
    logger: {
      debug(step, payload) {
        console.log(`[policy-flow:${step}]`, payload ?? "");
      },
    },
  };

  return {
    ...defaultPorts,
    ...options.policyFlowPorts,
  };
};

const rankCardsBySimilarity = (
  hypothesis: PolicyHypothesis,
  cards: PolicyCard[],
): PolicyCard[] =>
  [...cards].sort(
    (left, right) =>
      scoreCardSimilarity(hypothesis, right) -
      scoreCardSimilarity(hypothesis, left),
  );

const scoreCardSimilarity = (
  hypothesis: PolicyHypothesis,
  card: PolicyCard,
): number =>
  tokenOverlap(hypothesis.state, card.state) * 3 +
  tokenOverlap(hypothesis.action, card.action) * 2 +
  tokenOverlap(hypothesis.outcome, card.outcome);

const tokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/i)
    .filter((token) => token.length > 0);

const buildSimilarityClusters = async (
  episodes: EpisodeCase[],
  newEpisode: EpisodeCase,
  field: "state" | "action",
): Promise<EpisodeCase[][]> => {
  const clusters = episodes.filter((episode) => {
    if (episode.id === newEpisode.id) {
      return true;
    }
    return tokenOverlap(episode[field], newEpisode[field]) > 0;
  });
  return clusters.length >= 2 ? [clusters] : [];
};
