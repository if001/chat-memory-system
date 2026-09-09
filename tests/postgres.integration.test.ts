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
import { buildTurnRecordId } from "../src/memory_system/domain/identifiers";
import { MemoryRepository } from "../src/memory_system/infrastructure/postgres/repository";

const postgresUrl = process.env.MEMORY_SYSTEM_TEST_POSTGRES_URL;

const integrationTest = postgresUrl ? test : test.skip;
integrationTest(
  "UserMemory repository shares user scope, deduplicates, replaces, and deletes notes",
  async () => {
    const userId = `it-user-memory-${Date.now()}`;
    const repository = new MemoryRepository(postgresUrl as string);
    try {
      await cleanupUser(userId);
      const created = await repository.rememberUserNote(
        userId,
        "Prefer concise answers",
      );
      const duplicate = await repository.rememberUserNote(
        userId,
        " prefer concise answers! ",
      );
      assert.equal(duplicate.id, created.id);
      assert.equal((await repository.searchUserNotes(userId, "", 10)).length, 1);

      const replaced = await repository.replaceUserNote(
        userId,
        created.id,
        "Prefer detailed answers",
      );
      assert.equal(replaced?.note, "Prefer detailed answers");
      assert.deepEqual(
        (await repository.searchUserNotes(userId, "concise", 10)).map(
          (item) => item.note,
        ),
        [],
      );
      assert.equal(await repository.deleteUserNote(userId, created.id), true);
      assert.deepEqual(await repository.searchUserNotes(userId, "", 10), []);
    } finally {
      await cleanupUser(userId);
      await repository.close();
    }
  },
);

integrationTest(
  "repository persists episodes and policy cards with the new schema",
  async () => {
    const botId = `it-repo-${Date.now()}`;
    const otherBotId = `${botId}-other`;
    const repository = new MemoryRepository(postgresUrl as string);

    try {
      await cleanupBot(botId);
      await cleanupBot(otherBotId);

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
        appliesWhen:
          "User needs an implementation strategy for integration delivery.",
        recommendedBehavior:
          "Assistant compares concrete options with operational constraints.",
        avoidBehavior: "Do not choose an option without checking constraints.",
        episodeIds: ["ep-1"],
        createdAtIso: "2026-07-18T00:00:00.000Z",
        lastUpdatedIso: "2026-07-18T00:00:00.000Z",
      };

      await repository.saveEpisodeCase(episode);
      await repository.upsertPolicyCard(card);
      await repository.upsertPolicyCard({
        ...card,
        id: "pc-other",
        botId: otherBotId,
      });
      await repository.updateEpisodeRelatedCard(botId, ["ep-1"], "pc-1");

      const storedEpisode = await repository.fetchEpisodeById(botId, "ep-1");
      const storedCard = await repository.fetchPolicyCardById(botId, "pc-1");

      assert.equal(storedEpisode?.relatedCardId, "pc-1");
      assert.equal(storedEpisode?.state, episode.state);
      assert.deepEqual(storedCard?.episodeIds, ["ep-1"]);
      assert.equal(storedCard?.recommendedBehavior, card.recommendedBehavior);
      assert.equal(storedCard?.avoidBehavior, card.avoidBehavior);
      assert.deepEqual(
        (await repository.fetchPolicyCards(otherBotId, 10)).map(
          (item) => item.id,
        ),
        ["pc-other"],
      );
      assert.deepEqual(
        (await repository.fetchPolicyCards(botId, 10)).map((item) => item.id),
        ["pc-1"],
      );
    } finally {
      await cleanupBot(botId);
      await cleanupBot(otherBotId);
      await repository.close();
    }
  },
);

integrationTest(
  "turn records round-trip kinds, interaction ids, and bot/thread scopes",
  async () => {
    const suffix = Date.now();
    const botId = `it-turn-${suffix}`;
    const otherBotId = `it-turn-other-${suffix}`;
    const repository = new MemoryRepository(postgresUrl as string);
    const human = {
      ...buildTurnRecord(botId, "thread-1"),
      kind: "human" as const,
    };
    const proactive = {
      ...buildTurnRecord(botId, "thread-1"),
      kind: "proactive" as const,
      sourceInteractionId: "interaction-1",
      createdAtIso: "2026-07-18T00:01:00.000Z",
    };
    const delegation = {
      ...buildTurnRecord(botId, "thread-2"),
      kind: "delegation" as const,
      createdAtIso: "2026-07-18T00:02:00.000Z",
    };
    const otherBot = {
      ...buildTurnRecord(otherBotId, "thread-1"),
      kind: "human" as const,
    };

    try {
      await cleanupBot(botId);
      await cleanupBot(otherBotId);
      await Promise.all(
        [human, proactive, delegation, otherBot].map((record) =>
          repository.saveTurnRecord(record),
        ),
      );

      const threadOne = await repository.fetchTurnRecordsForThread(
        botId,
        "thread-1",
        10,
      );
      const threadTwo = await repository.fetchTurnRecordsForThread(
        botId,
        "thread-2",
        10,
      );
      const otherBotThread = await repository.fetchTurnRecordsForThread(
        otherBotId,
        "thread-1",
        10,
      );

      assert.deepEqual(
        threadOne.map(({ kind, sourceInteractionId }) => ({
          kind,
          sourceInteractionId,
        })),
        [
          { kind: "human", sourceInteractionId: undefined },
          { kind: "proactive", sourceInteractionId: "interaction-1" },
        ],
      );
      assert.deepEqual(threadTwo.map((record) => record.kind), ["delegation"]);
      assert.deepEqual(otherBotThread.map((record) => record.kind), ["human"]);
      assert.equal(threadOne[0]?.id, buildTurnRecordId(human));
      assert.equal(buildTurnRecordId(human), buildTurnRecordId({ ...human }));
    } finally {
      await cleanupBot(botId);
      await cleanupBot(otherBotId);
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
      assert.equal(storedCards[0]?.episodeIds.length, 2);
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
  }) as MemorySystemService & {
    llm: {
      generateJson<T>(systemPrompt?: string, userPrompt?: string): Promise<T>;
    };
    repository: MemoryRepository;
  };

  service.llm = {
    async generateJson<T>(_systemPrompt?: string, userPrompt?: string): Promise<T> {
      const payload = JSON.parse(userPrompt ?? "{}") as {
        chunkText?: string;
        policyCards?: Array<{ id: string }>;
      };
      if (payload.chunkText) {
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
      }
      if (payload.policyCards && payload.policyCards.length > 0) {
        return {
          decision: "merge",
          targetPolicyCardId: payload.policyCards[0]?.id,
        } as T;
      }
      return {
        appliesWhen: "User needs integration rollout guidance.",
        recommendedBehavior:
          "Compare concrete rollout options and operational tradeoffs.",
      } as T;
    },
  };

  return service;
};

const buildTurnRecord = (botId: string, threadId: string): TurnRecord => ({
  botId,
  threadId,
  kind: "human",
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

const cleanupUser = async (userId: string): Promise<void> => {
  const pool = new Pool({ connectionString: postgresUrl });
  try {
    await pool.query("DELETE FROM user_notes WHERE user_id = $1", [userId]);
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
