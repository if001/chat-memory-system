import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  createMemorySystemService,
  MemorySystemService,
} from "../src/memory_system/api/service";
import { MemoryRepository } from "../src/memory_system/infrastructure/postgres/repository";
import { PolicyCard, TurnRecord } from "../src/memory_system/domain/types";

const postgresUrl = process.env.MEMORY_SYSTEM_TEST_POSTGRES_URL ?? process.env.POSTGRES_URL;

const run = async (): Promise<void> => {
  if (!postgresUrl) {
    process.stdout.write(
      "[memory-system:test:integration] skipped: set MEMORY_SYSTEM_TEST_POSTGRES_URL or POSTGRES_URL\n",
    );
    return;
  }

  await testCreateNewPolicyCardFlow();
  await testMergePolicyCardFlow();
  await testSplitCandidateFlow();
};

const testCreateNewPolicyCardFlow = async (): Promise<void> => {
  const botId = `it-create-${Date.now()}`;
  const threadId = "thread-create";
  const service = createTestService(postgresUrl as string, [
    episodeExtractionResponse("implementation decision", "User wants a concrete implementation choice."),
    buildPolicyResponse("Implementation decision support"),
  ]);
  const repository = new MemoryRepository(postgresUrl as string);

  try {
    await cleanupBot(repository, botId);
    await service.ingestTurnRecord(buildTurnRecord(botId, threadId, "Choose between polling and webhook."));
    await service.buildConversationChunksForThread(botId, threadId, 20);
    const episodes = await service.processPendingEpisodes(botId, 20);
    const cards = await service.buildOrUpdatePolicyCards(botId, 20);

    assert.equal(episodes.length, 1);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.confidence, "low");

    const storedCards = await repository.fetchPolicyCards(botId, 10);
    assert.equal(storedCards.length, 1);
    assert.deepEqual(storedCards[0]?.evidenceEpisodeIds, [episodes[0]?.id]);
  } finally {
    await cleanupBot(repository, botId);
    await closeService(service);
    await repository.close();
  }
};

const testMergePolicyCardFlow = async (): Promise<void> => {
  const botId = `it-merge-${Date.now()}`;
  const threadId = "thread-merge";
  const service = createTestService(postgresUrl as string, [
    episodeExtractionResponse("implementation decision", "User wants a concrete implementation choice."),
    {
      decision: "merge",
      reason: "The same concrete implementation behavior still applies.",
      targetPolicyCardId: "pc-existing",
      updatedPolicyCard: {
        title: "Implementation decision support",
        appliesWhen: "User wants a concrete implementation choice.",
        recommendedBehavior: "Answer concretely and compare tradeoffs briefly.",
        avoidBehavior: "Do not stay abstract.",
        distinctionNotes: "Different from research framing questions.",
        confidence: "medium",
      },
    },
  ]);
  const repository = new MemoryRepository(postgresUrl as string);

  try {
    await cleanupBot(repository, botId);
    await repository.upsertPolicyCard({
      id: "pc-existing",
      botId,
      title: "Implementation decision support",
      appliesWhen: "User wants a concrete implementation choice.",
      recommendedBehavior: "Answer concretely.",
      avoidBehavior: "Do not stay abstract.",
      distinctionNotes: "",
      confidence: "low",
      evidenceEpisodeIds: ["ep-seed"],
      lastUpdatedIso: new Date().toISOString(),
    });

    await service.ingestTurnRecord(buildTurnRecord(botId, threadId, "Should I use webhook here?"));
    await service.buildConversationChunksForThread(botId, threadId, 20);
    const episodes = await service.processPendingEpisodes(botId, 20);
    const cards = await service.buildOrUpdatePolicyCards(botId, 20);

    assert.equal(episodes.length, 1);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.id, "pc-existing");

    const stored = await repository.fetchPolicyCardById(botId, "pc-existing");
    assert.ok(stored);
    assert.deepEqual(stored.evidenceEpisodeIds, ["ep-seed", episodes[0]!.id]);
    assert.match(stored.recommendedBehavior, /Answer concretely/);
  } finally {
    await cleanupBot(repository, botId);
    await closeService(service);
    await repository.close();
  }
};

const testSplitCandidateFlow = async (): Promise<void> => {
  const botId = `it-split-${Date.now()}`;
  const threadId = "thread-split";
  const service = createTestService(postgresUrl as string, [
    {
      stateLabel: "research framing",
      stateDescription: "User wants research framing rather than implementation steps.",
      actionLabel: "answer concretely",
      actionDescription: "Assistant answered too concretely.",
      outcome: "The answer mismatched the intent.",
      outcomeAssessment: {
        overall: "negative",
        score: -2,
        naturalLanguageJudgement: "The user wanted a different mode of answer.",
        updateHint: "split",
      },
      feedbackSignals: [
        {
          type: "distinction_request",
          text: "Research framing should be treated separately from implementation advice.",
          strength: "high",
          target: "state",
          updateHint: "split",
        },
      ],
      policyUpdateNote: "Separate research framing from implementation decisions.",
    },
    buildPolicyResponse("Research framing support"),
  ]);
  const repository = new MemoryRepository(postgresUrl as string);

  try {
    await cleanupBot(repository, botId);
    await repository.upsertPolicyCard({
      id: "pc-existing",
      botId,
      title: "Implementation decision support",
      appliesWhen: "User wants a concrete implementation choice.",
      recommendedBehavior: "Answer concretely.",
      avoidBehavior: "Do not stay abstract.",
      distinctionNotes: "",
      confidence: "high",
      evidenceEpisodeIds: ["ep-seed"],
      lastUpdatedIso: new Date().toISOString(),
    });

    await service.ingestTurnRecord(buildTurnRecord(botId, threadId, "I want the research framing, not implementation steps."));
    await service.buildConversationChunksForThread(botId, threadId, 20);
    const episodes = await service.processPendingEpisodes(botId, 20);
    const cards = await service.buildOrUpdatePolicyCards(botId, 20);

    assert.equal(episodes.length, 1);
    assert.equal(cards.length, 1);

    const candidates = await service.listOpenSplitCandidates(botId, 10);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.targetPolicyCardId, "pc-existing");

    const resolved = await service.resolveSplitCandidate(botId, candidates[0]!.id);
    assert.equal(resolved?.status, "resolved");

    const weakened = await repository.fetchPolicyCardById(botId, "pc-existing");
    assert.ok(weakened);
    assert.equal(weakened.confidence, "medium");
    assert.match(weakened.distinctionNotes, /Split boundary:/);

    const storedCards = await repository.fetchPolicyCards(botId, 10);
    assert.equal(storedCards.length, 2);
  } finally {
    await cleanupBot(repository, botId);
    await closeService(service);
    await repository.close();
  }
};

const createTestService = (
  connectionString: string,
  responses: unknown[],
): MemorySystemService => {
  const service = createMemorySystemService({
    postgresUrl: connectionString,
    ollamaBaseUrl: "http://test.invalid",
    ollamaModel: "stub",
    chunkSizeTurns: 4,
    chunkOverlapTurns: 1,
    policyQueryHistoryTurns: 2,
  }) as MemorySystemService & {
    llm: {
      generateJson<T>(): Promise<T>;
    };
    repository: MemoryRepository;
  };

  service.llm = {
    async generateJson<T>(): Promise<T> {
      if (responses.length === 0) {
        throw new Error("stub LLM response queue is empty");
      }
      return responses.shift() as T;
    },
  };
  return service;
};

const buildTurnRecord = (
  botId: string,
  threadId: string,
  userContent: string,
): TurnRecord => {
  const now = new Date().toISOString();
  return {
    botId,
    threadId,
    createdAtIso: now,
    messages: [
      {
        role: "user",
        content: userContent,
        timestampIso: now,
      },
      {
        role: "assistant",
        content: "stub answer",
        timestampIso: now,
      },
    ],
  };
};

const episodeExtractionResponse = (
  stateLabel: string,
  stateDescription: string,
): unknown => ({
  stateLabel,
  stateDescription,
  actionLabel: "answer concretely",
  actionDescription: "Assistant answered concretely.",
  outcome: "User could move forward.",
  outcomeAssessment: {
    overall: "positive",
    score: 1,
    naturalLanguageJudgement: "The answer matched the request.",
    updateHint: "strengthen",
  },
  feedbackSignals: [],
  policyUpdateNote: "Use a concrete implementation answer.",
});

const buildPolicyResponse = (title: string): unknown => ({
  title,
  appliesWhen: "User wants a concrete implementation choice.",
  recommendedBehavior: "Answer concretely and compare tradeoffs briefly.",
  avoidBehavior: "Do not stay abstract.",
  distinctionNotes: "Different from research framing questions.",
  confidence: "low",
});

const cleanupBot = async (
  repository: MemoryRepository,
  botId: string,
): Promise<void> => {
  const pool = new Pool({ connectionString: postgresUrl });
  try {
    await pool.query("DELETE FROM app.memory_policy_split_candidates WHERE bot_id = $1", [botId]);
    await pool.query("DELETE FROM app.memory_reports WHERE bot_id = $1", [botId]);
    await pool.query("DELETE FROM app.memory_policy_cards WHERE bot_id = $1", [botId]);
    await pool.query("DELETE FROM app.memory_episode_cases WHERE bot_id = $1", [botId]);
    await pool.query("DELETE FROM app.memory_conversation_chunks WHERE bot_id = $1", [botId]);
    await pool.query("DELETE FROM app.memory_turn_records WHERE bot_id = $1", [botId]);
  } finally {
    await pool.end();
  }
};

const closeService = async (service: MemorySystemService): Promise<void> => {
  const repository = (service as MemorySystemService & { repository?: MemoryRepository }).repository;
  if (repository) {
    await repository.close();
  }
};

void run();
