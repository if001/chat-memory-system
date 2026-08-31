import assert from "node:assert/strict";
import { Pool } from "pg";
import { test } from "vitest";
import {
  createMemorySystemService,
  MemorySystemService,
} from "../src/memory_system/api/service";
import {
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../src/memory_system/domain/types";
import { MemoryRepository } from "../src/memory_system/infrastructure/postgres/repository";

const postgresUrl = process.env.MEMORY_SYSTEM_TEST_POSTGRES_URL;

const integrationTest = postgresUrl ? test : test.skip;
integrationTest(
  "repository persists episodes and policy cards with the new schema",
  async () => {
    const botId = `it-repo-${Date.now()}`;
    const repository = new MemoryRepository(postgresUrl as string);

    try {
      await cleanupBot(botId);

      const episode: EpisodeCase = {
        id: "ep-1",
        botId,
        threadId: "thread-1",
        sourceChunkId: "chunk-1",
        state: "User compares webhook and polling.",
        action: "Assistant lists the tradeoffs and deployment constraints.",
        outcome: "A concrete integration path becomes clear.",
        stateEmbeddingVector: [],
        actionEmbeddingVector: [],
        outcomeEmbeddingVector: [],
        createdAtIso: "2026-07-18T00:00:00.000Z",
      };
      const card: PolicyCard = {
        id: "pc-1",
        botId,
        state:
          "User needs an implementation strategy for integration delivery.",
        action:
          "Assistant compares concrete options with operational constraints.",
        outcome: "A stable implementation policy is available for reuse.",
        stateEmbeddingVector: [],
        actionEmbeddingVector: [],
        outcomeEmbeddingVector: [],
        relatedEpisodeIds: ["ep-1"],
        createdAtIso: "2026-07-18T00:00:00.000Z",
        lastUpdatedIso: "2026-07-18T00:00:00.000Z",
      };

      await repository.saveEpisodeCase(episode);
      await repository.upsertPolicyCard(card);
      await repository.updateEpisodeRelatedCard(botId, ["ep-1"], "pc-1");

      const storedEpisode = await repository.fetchEpisodeById(botId, "ep-1");
      const storedCard = await repository.fetchPolicyCardById(botId, "pc-1");

      assert.equal(storedEpisode?.relatedCardId, "pc-1");
      assert.equal(storedEpisode?.state, episode.state);
      assert.deepEqual(storedCard?.relatedEpisodeIds, ["ep-1"]);
      assert.equal(storedCard?.action, card.action);
    } finally {
      await cleanupBot(botId);
      await repository.close();
    }
  },
);

integrationTest(
  "service processes episodes into a created policy card",
  async () => {
    const botId = `it-service-${Date.now()}`;
    const threadId = "thread-1";
    const service = createTestService(postgresUrl as string);
    const repository = new MemoryRepository(postgresUrl as string);

    try {
      await cleanupBot(botId);

      await service.ingestTurnRecord(buildTurnRecord(botId, threadId));
      await service.buildConversationChunksForThread(botId, threadId, 20);

      const episodes = await service.processPendingEpisodes(botId, 20);
      const cards = await service.buildOrUpdatePolicyCards(botId, 20);

      assert.equal(episodes.length, 2);
      assert.equal(cards.length, 1);

      const storedCards = await repository.fetchPolicyCards(botId, 10);
      const storedEpisodes = await repository.fetchRecentEpisodes(botId, 10);

      assert.equal(storedCards.length, 1);
      assert.equal(storedCards[0]?.relatedEpisodeIds.length, 2);
      assert.ok(
        storedEpisodes.every(
          (episode) => episode.relatedCardId === storedCards[0]?.id,
        ),
      );
    } finally {
      await cleanupBot(botId);
      await closeService(service);
      await repository.close();
    }
  },
);

const createTestService = (connectionString: string): MemorySystemService => {
  const service = createMemorySystemService({
    postgresUrl: connectionString,
    ollamaBaseUrl: "http://ollama.invalid",
    ollamaModel: "stub",
    ollamaAPIKey: "stub",
    chunkSizeTurns: 4,
    chunkOverlapTurns: 1,
    policyFlowPorts: {
      buildHypothesis: async (episodes) => ({
        state: "User needs integration rollout guidance.",
        action:
          "Assistant compares concrete rollout options and operational tradeoffs.",
        outcome: "A reusable rollout policy is created.",
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
  }) as MemorySystemService & {
    llm: {
      generateJson<T>(): Promise<T>;
    };
    repository: MemoryRepository;
  };

  service.llm = {
    async generateJson<T>(): Promise<T> {
      return {
        episodes: [
          {
            state: "User compares webhook and polling.",
            action: "Assistant enumerates tradeoffs.",
            outcome: "A concrete delivery choice becomes clearer.",
          },
          {
            state: "User asks about retries and failure handling.",
            action: "Assistant proposes retry policy and alerting.",
            outcome: "Operational constraints become clear.",
          },
        ],
      } as T;
    },
  };

  return service;
};

const buildTurnRecord = (botId: string, threadId: string): TurnRecord => ({
  botId,
  threadId,
  createdAtIso: "2026-07-18T00:00:00.000Z",
  messages: [
    {
      role: "user",
      content: "Should I use webhook or polling, and how should retries work?",
      timestampIso: "2026-07-18T00:00:00.000Z",
    },
    {
      role: "assistant",
      content: "Let me compare the delivery choices and failure handling.",
      timestampIso: "2026-07-18T00:00:01.000Z",
    },
  ],
});

const cleanupBot = async (botId: string): Promise<void> => {
  const pool = new Pool({ connectionString: postgresUrl });
  try {
    await pool.query("DELETE FROM app.memory_policy_cards WHERE bot_id = $1", [
      botId,
    ]);
    await pool.query("DELETE FROM app.memory_episode_cases WHERE bot_id = $1", [
      botId,
    ]);
    await pool.query(
      "DELETE FROM app.memory_conversation_chunks WHERE bot_id = $1",
      [botId],
    );
    await pool.query("DELETE FROM app.memory_turn_records WHERE bot_id = $1", [
      botId,
    ]);
  } finally {
    await pool.end();
  }
};

const closeService = async (service: MemorySystemService): Promise<void> => {
  const repository = (
    service as MemorySystemService & {
      repository?: MemoryRepository;
    }
  ).repository;
  if (repository) {
    await repository.close();
  }
};
