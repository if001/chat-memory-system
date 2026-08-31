import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createMemorySystemService,
  MemorySystemService,
} from "../src/memory_system/api/service";
import { PolicyFlowRecoverableError } from "../src/memory_system/application/usecases/policyCardFlow";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../src/memory_system/domain/types";

type RepositoryStub = {
  saveTurnRecord(input: TurnRecord): Promise<void>;
  fetchTurnRecordsForThread(
    botId: string,
    threadId: string,
    limit: number,
  ): Promise<TurnRecord[]>;
  fetchRecentTurnRecordsForThread(
    botId: string,
    threadId: string,
    limit: number,
  ): Promise<TurnRecord[]>;
  fetchThreadIdsForBot(botId: string, limit: number): Promise<string[]>;
  saveConversationChunks(chunks: ConversationChunk[]): Promise<void>;
  fetchPendingConversationChunks(
    botId: string,
    limit: number,
  ): Promise<ConversationChunk[]>;
  markConversationChunkProcessed(chunkId: string): Promise<void>;
  saveEpisodeCase(episode: EpisodeCase): Promise<void>;
  fetchPendingEpisodes(botId: string, limit: number): Promise<EpisodeCase[]>;
  fetchEpisodesByIds(botId: string, episodeIds: string[]): Promise<EpisodeCase[]>;
  fetchUnassignedEpisodes(botId: string, limit: number): Promise<EpisodeCase[]>;
  updateEpisodeRelatedCard(
    botId: string,
    episodeIds: string[],
    relatedCardId?: string,
  ): Promise<void>;
  markEpisodeProcessed(episodeId: string): Promise<void>;
  fetchPolicyCards(botId: string, limit: number): Promise<PolicyCard[]>;
  upsertPolicyCard(card: PolicyCard): Promise<void>;
};

type StubbedService = MemorySystemService & {
  llm: {
    generateJson<T>(systemPrompt?: string, userPrompt?: string): Promise<T>;
  };
  repository: RepositoryStub;
};

const buildEpisode = (
  id: string,
  overrides: Partial<EpisodeCase> = {},
): EpisodeCase => ({
  id,
  botId: "ao",
  threadId: "thread-1",
  sourceChunkId: "chunk-1",
  state: `state-${id}`,
  action: `action-${id}`,
  outcome: `outcome-${id}`,
  stateEmbeddingVector: [],
  actionEmbeddingVector: [],
  outcomeEmbeddingVector: [],
  createdAtIso: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

const buildPolicyCard = (
  id: string,
  relatedEpisodeIds: string[],
  overrides: Partial<PolicyCard> = {},
): PolicyCard => ({
  id,
  botId: "ao",
  state: `state-${id}`,
  action: `action-${id}`,
  outcome: `outcome-${id}`,
  stateEmbeddingVector: [],
  actionEmbeddingVector: [],
  outcomeEmbeddingVector: [],
  relatedEpisodeIds,
  createdAtIso: "2026-07-18T00:00:00.000Z",
  lastUpdatedIso: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

const buildConversationChunk = (id: string): ConversationChunk => ({
  id,
  botId: "ao",
  threadId: "thread-1",
  turnRecordIds: ["turn-1"],
  startCreatedAtIso: "2026-07-18T00:00:00.000Z",
  endCreatedAtIso: "2026-07-18T00:01:00.000Z",
  chunkText: "conversation chunk",
  turnCount: 1,
  tokenEstimate: 12,
  createdAtIso: "2026-07-18T00:02:00.000Z",
});

const buildTurnRecord = (
  userContent: string,
  assistantContent: string,
): TurnRecord => ({
  id: `turn-${Math.random()}`,
  botId: "ao",
  threadId: "thread-1",
  createdAtIso: "2026-07-18T00:00:00.000Z",
  messages: [
    {
      role: "user",
      content: userContent,
      timestampIso: "2026-07-18T00:00:00.000Z",
    },
    {
      role: "assistant",
      content: assistantContent,
      timestampIso: "2026-07-18T00:00:01.000Z",
    },
  ],
});

test("processPendingEpisodes saves every extracted episode and marks chunk processed", async () => {
  const savedEpisodes: EpisodeCase[] = [];
  const markedChunkIds: string[] = [];
  const service = createStubbedService(
    {
      fetchPendingConversationChunks: async () => [buildConversationChunk("chunk-1")],
      saveEpisodeCase: async (episode) => {
        savedEpisodes.push(episode);
      },
      markConversationChunkProcessed: async (chunkId) => {
        markedChunkIds.push(chunkId);
      },
    },
    [
      {
        episodes: [
          {
            state: "User compares webhook and polling.",
            action: "Assistant lists tradeoffs.",
            outcome: "A decision path is clear.",
          },
          {
            state: "User asks about retries.",
            action: "Assistant proposes retry policy.",
            outcome: "Failure handling is clearer.",
          },
        ],
      },
    ],
  );

  const episodes = await service.processPendingEpisodes("ao", 10);

  assert.equal(episodes.length, 2);
  assert.equal(savedEpisodes.length, 2);
  assert.deepEqual(markedChunkIds, ["chunk-1"]);
});

test("buildOrUpdatePolicyCards persists created cards and assignments", async () => {
  const processedEpisodeIds: string[] = [];
  const updatedAssignments: Array<{ episodeIds: string[]; relatedCardId?: string }> = [];
  const upsertedCards: PolicyCard[] = [];
  const older = buildEpisode("ep-older", {
    state: "User asks for rollout guidance.",
    action: "Assistant suggests deployment steps.",
    outcome: "A rollout path is available.",
  });
  const incoming = buildEpisode("ep-new", {
    state: "User asks for rollout guidance.",
    action: "Assistant suggests deployment steps.",
    outcome: "A rollout path is validated.",
  });
  const service = createStubbedService(
    {
      fetchPendingEpisodes: async () => [incoming],
      fetchPolicyCards: async () => [],
      fetchEpisodesByIds: async () => [],
      fetchUnassignedEpisodes: async () => [older, incoming],
      upsertPolicyCard: async (card) => {
        upsertedCards.push(card);
      },
      updateEpisodeRelatedCard: async (_botId, episodeIds, relatedCardId) => {
        updatedAssignments.push({ episodeIds, relatedCardId });
      },
      markEpisodeProcessed: async (episodeId) => {
        processedEpisodeIds.push(episodeId);
      },
    },
    [],
    {
      buildHypothesis: async (episodes) => ({
        state: "User needs rollout guidance.",
        action: "Assistant suggests deployment steps.",
        outcome: "A rollout policy is formed.",
        stateEmbeddingVector: [],
        actionEmbeddingVector: [],
        outcomeEmbeddingVector: [],
        relatedEpisodeIds: episodes.map((episode) => episode.id),
      }),
      searchCards: async () => [],
      evaluateEpisodes: async () => ({ consistent: true, clear: true }),
      evaluateSplit: async () => ({ consistent: false, clear: false }),
      clusterByState: async (episodes) => [episodes],
      clusterByAction: async (episodes) => [episodes],
    },
  );

  const cards = await service.buildOrUpdatePolicyCards("ao", 10);

  assert.equal(cards.length, 1);
  assert.equal(upsertedCards.length, 1);
  assert.deepEqual(processedEpisodeIds, ["ep-new"]);
  assert.equal(updatedAssignments.length, 1);
  assert.deepEqual(updatedAssignments[0]?.episodeIds.sort(), ["ep-new", "ep-older"]);
  assert.equal(updatedAssignments[0]?.relatedCardId, upsertedCards[0]?.id);
});

test("queryApplicablePolicyCards filters by ids returned from llm", async () => {
  const service = createStubbedService(
    {
      fetchRecentTurnRecordsForThread: async () => [
        buildTurnRecord("need implementation help", "ok"),
      ],
      fetchPolicyCards: async () => [
        buildPolicyCard("pc-1", []),
        buildPolicyCard("pc-2", []),
      ],
    },
    [["pc-2"]],
  );

  const cards = await service.queryApplicablePolicyCards({
    botId: "ao",
    threadId: "thread-1",
    currentContext: "decide implementation strategy",
  });

  assert.deepEqual(
    cards.map((card) => card.id),
    ["pc-2"],
  );
});

test("buildOrUpdatePolicyCards leaves failed episode unassigned and continues", async () => {
  const processedEpisodeIds: string[] = [];
  const updatedAssignments: Array<{ episodeIds: string[]; relatedCardId?: string }> = [];
  const upsertedCards: PolicyCard[] = [];
  const first = buildEpisode("ep-failed");
  const supporting = buildEpisode("ep-support", {
    state: "User asks for rollout guidance.",
    action: "Assistant suggests deployment steps.",
    outcome: "A rollout path is available.",
  });
  const second = buildEpisode("ep-created", {
    state: "User asks for rollout guidance.",
    action: "Assistant suggests deployment steps.",
    outcome: "A rollout path is validated.",
  });
  let buildHypothesisCalls = 0;

  const service = createStubbedService(
    {
      fetchPendingEpisodes: async () => [first, second],
      fetchPolicyCards: async () => [],
      fetchEpisodesByIds: async () => [],
      fetchUnassignedEpisodes: async () => [first, supporting, second],
      upsertPolicyCard: async (card) => {
        upsertedCards.push(card);
      },
      updateEpisodeRelatedCard: async (_botId, episodeIds, relatedCardId) => {
        updatedAssignments.push({ episodeIds, relatedCardId });
      },
      markEpisodeProcessed: async (episodeId) => {
        processedEpisodeIds.push(episodeId);
      },
    },
    [],
    {
      buildHypothesis: async (episodes) => {
        buildHypothesisCalls += 1;
        if (episodes.some((episode) => episode.id === "ep-failed")) {
          throw new PolicyFlowRecoverableError("llm failed");
        }
        return {
          state: "User needs rollout guidance.",
          action: "Assistant suggests deployment steps.",
          outcome: "A rollout policy is formed.",
          stateEmbeddingVector: [],
          actionEmbeddingVector: [],
          outcomeEmbeddingVector: [],
          relatedEpisodeIds: episodes.map((episode) => episode.id),
        };
      },
      searchCards: async () => [],
      evaluateEpisodes: async () => ({ consistent: true, clear: true }),
      evaluateSplit: async () => ({ consistent: false, clear: false }),
      clusterByState: async (episodes) =>
        episodes.some((episode) => episode.id === "ep-created") ? [episodes] : [],
      clusterByAction: async (episodes) =>
        episodes.some((episode) => episode.id === "ep-created") ? [episodes] : [],
    },
  );

  const cards = await service.buildOrUpdatePolicyCards("ao", 10);

  assert.equal(cards.length, 1);
  assert.equal(upsertedCards.length, 1);
  assert.deepEqual(processedEpisodeIds, ["ep-failed", "ep-created"]);
  assert.equal(updatedAssignments.length, 1);
  assert.deepEqual(updatedAssignments[0]?.episodeIds.sort(), ["ep-created", "ep-support"]);
  assert.ok(buildHypothesisCalls >= 2);
});

const createStubbedService = (
  repositoryOverrides: Partial<RepositoryStub>,
  generateJsonQueue: unknown[],
  policyFlowPorts?: Parameters<typeof createMemorySystemService>[0]["policyFlowPorts"],
): StubbedService => {
  const service = createMemorySystemService({
    postgresUrl: "postgres://example.invalid",
    ollamaBaseUrl: "http://ollama.invalid",
    ollamaModel: "stub",
    ollamaAPIKey: "stub",
    policyFlowPorts,
  }) as StubbedService;

  service.llm = {
    async generateJson<T>(): Promise<T> {
      if (generateJsonQueue.length === 0) {
        throw new Error("stub llm queue is empty");
      }
      return generateJsonQueue.shift() as T;
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
    fetchUnassignedEpisodes: async () => [],
    updateEpisodeRelatedCard: async () => {},
    markEpisodeProcessed: async () => {},
    fetchPolicyCards: async () => [],
    upsertPolicyCard: async () => {},
    ...repositoryOverrides,
  };

  return service;
};
