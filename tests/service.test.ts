import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createMemorySystemService,
  MemorySystemService,
} from "../src/memory_system/api/service";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../src/memory_system/domain/types";

type RepositoryStub = {
  saveTurnRecord(input: TurnRecord): Promise<void>;
  fetchTurnRecordsForThread(botId: string, threadId: string, limit: number): Promise<TurnRecord[]>;
  fetchRecentTurnRecordsForThread(botId: string, threadId: string, limit: number): Promise<TurnRecord[]>;
  fetchThreadIdsForBot(botId: string, limit: number): Promise<string[]>;
  saveConversationChunks(chunks: ConversationChunk[]): Promise<void>;
  fetchPendingConversationChunks(botId: string, limit: number): Promise<ConversationChunk[]>;
  markConversationChunkProcessed(chunkId: string): Promise<void>;
  saveEpisodeCase(episode: EpisodeCase): Promise<void>;
  fetchPendingEpisodes(botId: string, limit: number): Promise<EpisodeCase[]>;
  fetchEpisodesByIds(botId: string, episodeIds: string[]): Promise<EpisodeCase[]>;
  updateEpisodeRelatedCard(botId: string, episodeIds: string[], relatedCardId?: string): Promise<void>;
  markEpisodeProcessed(episodeId: string): Promise<void>;
  fetchPolicyCards(botId: string, limit: number): Promise<PolicyCard[]>;
  upsertPolicyCard(card: PolicyCard): Promise<void>;
};

type StubbedService = MemorySystemService & {
  llm: { generateJson<T>(): Promise<T> };
  repository: RepositoryStub;
};

const episode = (id: string, action = `action-${id}`): EpisodeCase => ({
  id,
  botId: "ao",
  threadId: "thread-1",
  sourceChunkId: "chunk-1",
  state: `state-${id}`,
  action,
  outcome: `outcome-${id}`,
  stateEmbeddingVector: [],
  actionEmbeddingVector: [],
  outcomeEmbeddingVector: [],
  createdAtIso: "2026-07-18T00:00:00.000Z",
});

const card = (id: string, episodeIds: string[]): PolicyCard => ({
  id,
  botId: "ao",
  appliesWhen: "User needs rollout guidance.",
  recommendedBehavior: "Compare rollout options and constraints.",
  episodeIds,
  createdAtIso: "2026-07-18T00:00:00.000Z",
  lastUpdatedIso: "2026-07-18T00:00:00.000Z",
});

test("processPendingEpisodes saves extracted episodes and marks the chunk processed", async () => {
  const saved: EpisodeCase[] = [];
  const marked: string[] = [];
  const chunk: ConversationChunk = {
    id: "chunk-1",
    botId: "ao",
    threadId: "thread-1",
    turnRecordIds: ["turn-1"],
    startCreatedAtIso: "2026-07-18T00:00:00.000Z",
    endCreatedAtIso: "2026-07-18T00:01:00.000Z",
    chunkText: "conversation chunk",
    turnCount: 1,
    tokenEstimate: 12,
    createdAtIso: "2026-07-18T00:02:00.000Z",
  };
  const service = createStubbedService(
    {
      fetchPendingConversationChunks: async () => [chunk],
      saveEpisodeCase: async (item) => { saved.push(item); },
      markConversationChunkProcessed: async (id) => { marked.push(id); },
    },
    [{ episodes: [{ state: "state", action: "action", outcome: "outcome" }] }],
  );

  const result = await service.processPendingEpisodes("ao", 10);

  assert.equal(result.length, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(marked, ["chunk-1"]);
});

test("buildOrUpdatePolicyCards creates then updates one card with traceable episodes", async () => {
  const episodes = [episode("ep-1"), episode("ep-2")];
  const cards: PolicyCard[] = [];
  const assignments: Array<{ episodeIds: string[]; cardId?: string }> = [];
  const fetchedEvidence: string[][] = [];
  let llmCalls = 0;
  const service = createStubbedService(
    {
      fetchPendingEpisodes: async () => episodes,
      fetchPolicyCards: async () => cards,
      fetchEpisodesByIds: async (_botId, ids) => {
        fetchedEvidence.push(ids);
        return episodes.filter((item) => ids.includes(item.id));
      },
      upsertPolicyCard: async (item) => {
        cards.splice(0, cards.length, item);
      },
      updateEpisodeRelatedCard: async (_botId, episodeIds, cardId) => {
        assignments.push({ episodeIds, cardId });
      },
    },
    [
      {
        appliesWhen: "User needs rollout guidance.",
        recommendedBehavior: "Compare rollout options and constraints.",
      },
      { decision: "merge", targetPolicyCardId: "ignored-until-known" },
      {
        appliesWhen: "User needs rollout guidance.",
        recommendedBehavior: "Compare rollout options and constraints.",
      },
    ],
  );
  service.llm.generateJson = async <T>(): Promise<T> => {
    llmCalls += 1;
    if (llmCalls === 1) {
      return {
        appliesWhen: "User needs rollout guidance.",
        recommendedBehavior: "Compare rollout options and constraints.",
      } as T;
    }
    if (llmCalls === 2) {
      return { decision: "merge", targetPolicyCardId: cards[0]?.id } as T;
    }
    return {
      appliesWhen: "User needs rollout guidance.",
      recommendedBehavior: "Compare rollout options and constraints.",
    } as T;
  };

  const result = await service.buildOrUpdatePolicyCards("ao", 10);

  assert.equal(result.length, 2);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0]?.episodeIds, ["ep-1", "ep-2"]);
  assert.equal(assignments.at(-1)?.cardId, cards[0]?.id);
  assert.deepEqual(fetchedEvidence.at(-1), ["ep-1"]);
});

test("queryApplicablePolicyCards filters model-selected cards and ignores cards without evidence", async () => {
  const evidenced = card("pc-evidenced", ["ep-1"]);
  const service = createStubbedService(
    {
      fetchPolicyCards: async () => [card("pc-empty", []), evidenced],
    },
    [["pc-evidenced"]],
  );

  const result = await service.queryApplicablePolicyCards({
    botId: "ao",
    threadId: "thread-1",
    currentContext: "Need rollout guidance",
  });

  assert.deepEqual(result, [evidenced]);
});

const createStubbedService = (
  repositoryOverrides: Partial<RepositoryStub>,
  responses: unknown[] = [],
): StubbedService => {
  const service = createMemorySystemService({
    postgresUrl: "postgres://example.invalid",
    ollamaBaseUrl: "http://ollama.invalid",
    ollamaModel: "stub",
    ollamaAPIKey: "stub",
  }) as StubbedService;
  service.llm = {
    async generateJson<T>(): Promise<T> {
      if (responses.length === 0) {
        throw new Error("stub llm queue is empty");
      }
      return responses.shift() as T;
    },
  };
  service.repository = {
    saveTurnRecord: async () => {},
    fetchTurnRecordsForThread: async () => [],
    fetchRecentTurnRecordsForThread: async () => [],
    fetchThreadIdsForBot: async () => [],
    saveConversationChunks: async () => {},
    fetchPendingConversationChunks: async () => [],
    markConversationChunkProcessed: async () => {},
    saveEpisodeCase: async () => {},
    fetchPendingEpisodes: async () => [],
    fetchEpisodesByIds: async () => [],
    updateEpisodeRelatedCard: async () => {},
    markEpisodeProcessed: async () => {},
    fetchPolicyCards: async () => [],
    upsertPolicyCard: async () => {},
    ...repositoryOverrides,
  };
  return service;
};
