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
  PolicySplitCandidate,
  TurnRecord,
} from "../src/memory_system/domain/types";

test("getRecentConversationContext uses repository history", async () => {
  const service = createStubbedService({
    fetchRecentTurnRecordsForThread: async () => [
      buildTurnRecord("ao", "thread-1", "older question", "older answer"),
      buildTurnRecord(
        "ao",
        "thread-1",
        "current implementation choice",
        "concrete suggestion",
      ),
    ],
  });

  const result = await service.getRecentConversationContext({
    botId: "ao",
    threadId: "thread-1",
    limit: 2,
    maxTokens: 60,
  });

  assert.match(result, /current implementation choice/);
  assert.match(result, /concrete suggestion/);
});

test("buildConversationChunksForThread saves built chunks", async () => {
  const savedChunks: ConversationChunk[][] = [];
  const turns = [
    buildTurnRecord("ao", "thread-1", "u1", "a1", "2026-05-26T00:00:00.000Z"),
    buildTurnRecord("ao", "thread-1", "u2", "a2", "2026-05-26T00:01:00.000Z"),
  ];
  const service = createStubbedService({
    fetchTurnRecordsForThread: async () => turns,
    saveConversationChunks: async (chunks) => {
      savedChunks.push(chunks);
    },
  });

  const result = await service.buildConversationChunksForThread(
    "ao",
    "thread-1",
    20,
  );

  assert.equal(result.length, 1);
  assert.equal(savedChunks.length, 1);
  assert.equal(savedChunks[0]?.[0]?.threadId, "thread-1");
});

test("processPendingEpisodes saves episodes and marks chunks processed", async () => {
  const savedEpisodes: EpisodeCase[] = [];
  const markedChunkIds: string[] = [];
  const service = createStubbedService({
    generateJsonQueue: [
      {
        stateLabel: "implementation decision",
        stateDescription: "User wants a concrete implementation choice.",
        actionLabel: "answer concretely",
        actionDescription: "Assistant answered concretely.",
        outcome: "User moved forward.",
        outcomeAssessment: {
          overall: "positive",
          score: 1,
          naturalLanguageJudgement: "The answer matched the request.",
          updateHint: "strengthen",
        },
        feedbackSignals: [],
        policyUpdateNote: "Use a concrete implementation answer.",
      },
    ],
    fetchPendingConversationChunks: async () => [
      buildConversationChunk("ao", "thread-1", "chunk-1"),
    ],
    saveEpisodeCase: async (episode) => {
      savedEpisodes.push(episode);
    },
    markConversationChunkProcessed: async (chunkId) => {
      markedChunkIds.push(chunkId);
    },
  });

  const episodes = await service.processPendingEpisodes("ao", 10);

  assert.equal(episodes.length, 1);
  assert.equal(savedEpisodes.length, 1);
  assert.deepEqual(markedChunkIds, ["chunk-1"]);
});

test("buildOrUpdatePolicyCards returns empty when no pending episodes exist", async () => {
  const service = createStubbedService({
    fetchPendingEpisodes: async () => [],
  });

  const cards = await service.buildOrUpdatePolicyCards("ao", 10);
  assert.deepEqual(cards, []);
});

test("buildOrUpdatePolicyCards merges existing card and marks episode processed", async () => {
  const processedEpisodeIds: string[] = [];
  const upsertedCards: PolicyCard[] = [];
  const episode = buildEpisode("ao", "thread-1", "ep-1");
  const existingCard = buildPolicyCard("ao", "pc-1");
  const service = createStubbedService({
    generateJsonQueue: [
      {
        decision: "merge",
        reason: "The same concrete implementation behavior still applies.",
        targetPolicyCardId: "pc-1",
      },
      {
        title: "Implementation decision support",
        appliesWhen: "User wants a concrete implementation choice.",
        recommendedBehavior: "Answer concretely and compare tradeoffs briefly.",
        avoidBehavior: "Do not stay abstract.",
        distinctionNotes: "Different from research framing questions.",
      },
    ],
    fetchPendingEpisodes: async () => [episode],
    fetchPolicyCards: async () => [existingCard],
    upsertPolicyCard: async (card) => {
      upsertedCards.push(card);
    },
    markEpisodeProcessed: async (episodeId) => {
      processedEpisodeIds.push(episodeId);
    },
  });

  const cards = await service.buildOrUpdatePolicyCards("ao", 10);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, "pc-1");
  assert.equal(upsertedCards.length, 1);
  assert.deepEqual(processedEpisodeIds, ["ep-1"]);
});

test("queryApplicablePolicyCards filters llm-selected candidate ids", async () => {
  const service = createStubbedService({
    generateJsonQueue: [["pc-2"]],
    fetchRecentTurnRecordsForThread: async () => [
      buildTurnRecord("ao", "thread-1", "need implementation help", "ok"),
    ],
    fetchPolicyCards: async () => [
      buildPolicyCard("ao", "pc-1"),
      buildPolicyCard("ao", "pc-2"),
    ],
  });

  const cards = await service.queryApplicablePolicyCards({
    botId: "ao",
    threadId: "thread-1",
    currentContext: "please decide implementation strategy",
  });

  assert.deepEqual(
    cards.map((card) => card.id),
    ["pc-2"],
  );
});

test("resolveSplitCandidate returns null when candidate is missing", async () => {
  const service = createStubbedService({
    fetchPolicySplitCandidateById: async () => null,
  });

  const result = await service.resolveSplitCandidate("ao", "missing");
  assert.equal(result, null);
});

test("ignoreSplitCandidate updates candidate status", async () => {
  const updatedStatuses: Array<{ id: string; status: string }> = [];
  const candidate = buildSplitCandidate("ao", "candidate-1");
  const service = createStubbedService({
    fetchPolicySplitCandidateById: async () => candidate,
    updatePolicySplitCandidateStatus: async (_botId, id, status) => {
      updatedStatuses.push({ id, status });
    },
  });

  const result = await service.ignoreSplitCandidate("ao", "candidate-1");

  assert.equal(result?.status, "ignored");
  assert.deepEqual(updatedStatuses, [{ id: "candidate-1", status: "ignored" }]);
});

test("generateMemoryReport delegates built signals to repository", async () => {
  const service = createStubbedService({
    fetchPolicyCards: async () => [
      buildPolicyCard("ao", "pc-1", {
        confidence: "low",
        lastUpdatedIso: "2026-01-01T00:00:00.000Z",
      }),
    ],
    createMemoryReport: async (botId, threadId, gaps, staleNotes, conflicts) => ({
      botId,
      threadId,
      gaps,
      staleNotes,
      conflicts,
      createdAtIso: "2026-05-26T00:00:00.000Z",
    }),
  });

  const report = await service.generateMemoryReport("ao", "thread-1");

  assert.ok(report.gaps.includes("No high-confidence policy card exists"));
  assert.ok(report.staleNotes.some((note) => note.includes("pc-1")));
});

test("generateRelationshipInsightReport returns llm-derived user-facing candidates", async () => {
  const service = createStubbedService({
    generateJsonQueue: [
      {
        clarificationCandidates: ["Ask whether shorter proactive updates are preferred."],
        proactiveContextCandidates: ["Share the current implementation constraint before proposing options."],
        repairCandidates: ["Repair the recent mismatch between research framing and implementation support."],
        boundaryCandidates: ["Clarify whether future questions should stay within implementation support."],
      },
    ],
    fetchRecentTurnRecordsForThread: async () => [
      buildTurnRecord(
        "ao",
        "thread-1",
        "実装よりの提案が欲しいです",
        "了解しました",
      ),
    ],
    fetchPolicyCards: async () => [buildPolicyCard("ao", "pc-1")],
  });

  const report = await service.generateRelationshipInsightReport("ao", "thread-1");

  assert.deepEqual(report.clarificationCandidates, [
    "Ask whether shorter proactive updates are preferred.",
  ]);
  assert.deepEqual(report.proactiveContextCandidates, [
    "Share the current implementation constraint before proposing options.",
  ]);
  assert.deepEqual(report.repairCandidates, [
    "Repair the recent mismatch between research framing and implementation support.",
  ]);
  assert.deepEqual(report.boundaryCandidates, [
    "Clarify whether future questions should stay within implementation support.",
  ]);
});

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
  markEpisodeProcessed(episodeId: string): Promise<void>;
  fetchPolicyCards(botId: string, limit: number): Promise<PolicyCard[]>;
  upsertPolicyCard(card: PolicyCard): Promise<void>;
  savePolicySplitCandidate(candidate: PolicySplitCandidate): Promise<void>;
  fetchOpenSplitCandidates(botId: string, limit: number): Promise<PolicySplitCandidate[]>;
  fetchPolicySplitCandidateById(
    botId: string,
    candidateId: string,
  ): Promise<PolicySplitCandidate | null>;
  updatePolicySplitCandidateStatus(
    botId: string,
    candidateId: string,
    status: PolicySplitCandidate["status"],
  ): Promise<void>;
  fetchEpisodeById(botId: string, episodeId: string): Promise<EpisodeCase | null>;
  fetchPolicyCardById(
    botId: string,
    policyCardId: string,
  ): Promise<PolicyCard | null>;
  createMemoryReport(
    botId: string,
    threadId: string,
    gaps: string[],
    staleNotes: string[],
    conflicts: string[],
  ): Promise<{
    botId: string;
    threadId: string;
    gaps: string[];
    staleNotes: string[];
    conflicts: string[];
    createdAtIso: string;
  }>;
};

const createStubbedService = (
  overrides: Partial<RepositoryStub> & { generateJsonQueue?: unknown[] } = {},
): MemorySystemService => {
  const service = createMemorySystemService({
    postgresUrl: "postgres://example",
    ollamaBaseUrl: "http://ollama.local",
    ollamaModel: "qwen3",
    ollamaAPIKey: "test-key",
  }) as MemorySystemService & {
    llm: { generateJson<T>(): Promise<T> };
    repository: RepositoryStub;
  };

  const generateJsonQueue = [...(overrides.generateJsonQueue ?? [])];
  service.llm = {
    async generateJson<T>(): Promise<T> {
      if (generateJsonQueue.length === 0) {
        throw new Error("stub LLM response queue is empty");
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
    markEpisodeProcessed: async () => {},
    fetchPolicyCards: async () => [],
    upsertPolicyCard: async () => {},
    savePolicySplitCandidate: async () => {},
    fetchOpenSplitCandidates: async () => [],
    fetchPolicySplitCandidateById: async () => null,
    updatePolicySplitCandidateStatus: async () => {},
    fetchEpisodeById: async () => null,
    fetchPolicyCardById: async () => null,
    createMemoryReport: async (botId, threadId, gaps, staleNotes, conflicts) => ({
      botId,
      threadId,
      gaps,
      staleNotes,
      conflicts,
      createdAtIso: "2026-05-26T00:00:00.000Z",
    }),
    ...overrides,
  };

  return service;
};

const buildTurnRecord = (
  botId: string,
  threadId: string,
  userContent: string,
  assistantContent: string,
  createdAtIso: string = "2026-05-26T00:00:00.000Z",
): TurnRecord => ({
  id: `turn-${createdAtIso}`,
  botId,
  threadId,
  createdAtIso,
  messages: [
    { role: "user", content: userContent, timestampIso: createdAtIso },
    { role: "assistant", content: assistantContent, timestampIso: createdAtIso },
  ],
});

const buildConversationChunk = (
  botId: string,
  threadId: string,
  id: string,
): ConversationChunk => ({
  id,
  botId,
  threadId,
  turnRecordIds: ["turn-1"],
  startCreatedAtIso: "2026-05-26T00:00:00.000Z",
  endCreatedAtIso: "2026-05-26T00:01:00.000Z",
  chunkText: "Turn 1\n[user] hello",
  turnCount: 1,
  tokenEstimate: 10,
  createdAtIso: "2026-05-26T00:02:00.000Z",
});

const buildEpisode = (
  botId: string,
  threadId: string,
  id: string,
): EpisodeCase => ({
  id,
  botId,
  threadId,
  stateLabel: "implementation decision",
  stateDescription: "User wants a concrete implementation decision.",
  actionLabel: "answer concretely",
  actionDescription: "Assistant answered concretely.",
  outcome: "User moved forward.",
  outcomeAssessment: {
    overall: "positive",
    score: 1,
    naturalLanguageJudgement: "The answer matched the request.",
    updateHint: "strengthen",
  },
  feedbackSignals: [],
  policyUpdateNote: "Use a concrete implementation answer.",
  createdAtIso: "2026-05-26T00:00:00.000Z",
});

const buildPolicyCard = (
  botId: string,
  id: string,
  overrides: Partial<PolicyCard> = {},
): PolicyCard => ({
  id,
  botId,
  title: "Implementation decision support",
  appliesWhen: "User wants a concrete implementation choice.",
  recommendedBehavior: "Answer concretely and compare tradeoffs briefly.",
  avoidBehavior: "Do not stay abstract.",
  distinctionNotes: "Different from research framing questions.",
  confidence: "medium",
  evidenceEpisodeIds: ["ep-1"],
  lastUpdatedIso: "2026-05-26T00:00:00.000Z",
  ...overrides,
});

const buildSplitCandidate = (
  botId: string,
  id: string,
): PolicySplitCandidate => ({
  id,
  botId,
  episodeId: "ep-1",
  targetPolicyCardId: "pc-1",
  reason: "Current policy should be split.",
  status: "open",
  createdAtIso: "2026-05-26T00:00:00.000Z",
});
