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
import { UserNote } from "../src/memory_system/domain/userMemory";
import { DailyEvent } from "../src/memory_system/domain/dailyEvent";
import { TurnSearchIndexEntry } from "../src/memory_system/application/usecases/turnSearchIndex";
import { TurnRecordSearchRequest } from "../src/memory_system/api/contracts";
import { UserMemorySearchIndexEntry } from "../src/memory_system/application/usecases/userMemorySearch";

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
  rememberUserNote(userId: string, note: string): Promise<UserNote>;
  searchUserNotes(
    userId: string,
    query: string,
    limit: number,
  ): Promise<UserNote[]>;
  replaceUserNote(
    userId: string,
    noteId: number,
    note: string,
  ): Promise<UserNote | null>;
  deleteUserNote(userId: string, noteId: number): Promise<boolean>;
  upsertUserMemorySearchIndex(entry: UserMemorySearchIndexEntry): Promise<void>;
  deleteUserMemorySearchIndex(noteId: number): Promise<void>;
  fetchUserMemorySearchCandidates(
    userId: string,
    limit: number,
  ): Promise<Array<UserMemorySearchIndexEntry & { createdAt: Date }>>;
  fetchUnindexedUserNotes(userId: string, limit: number): Promise<UserNote[]>;
  rememberDailyEvent(input: {
    userId: string;
    eventDate: string;
    summary: string;
  }): Promise<DailyEvent>;
  searchDailyEvents(input: {
    userId: string;
    query: string;
    from?: string;
    to?: string;
  }): Promise<DailyEvent[]>;
  getDailyEventsByDate(input: {
    userId: string;
    date: string;
  }): Promise<DailyEvent[]>;
  upsertTurnSearchIndex(entry: TurnSearchIndexEntry): Promise<void>;
  fetchTurnSearchCandidates(
    input: TurnRecordSearchRequest,
    limit: number,
  ): Promise<TurnSearchIndexEntry[]>;
  fetchUnindexedTurnRecords(botId: string, limit: number): Promise<TurnRecord[]>;
};

type StubbedService = MemorySystemService & {
  llm: { generateJson<T>(): Promise<T> };
  repository: RepositoryStub;
  embedText?: (text: string) => Promise<number[]>;
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

test("unified policy search keeps bot scope, caps results, and returns minimal payload", async () => {
  const fetchedBotIds: string[] = [];
  const cards = [1, 2, 3, 4].map((index) => ({
    ...card(`pc-${index}`, [`ep-${index}`]),
    botId: "ao",
    createdAtIso: `2026-07-1${index}T00:00:00.000Z`,
    lastUpdatedIso: `2026-07-1${index}T00:00:00.000Z`,
  }));
  const service = createStubbedService(
    {
      fetchPolicyCards: async (botId) => {
        fetchedBotIds.push(botId);
        return cards;
      },
    },
    [cards.map((item) => item.id)],
  );

  const result = await service.search({
    botId: "ao",
    threadId: "thread-1",
    userId: "shared-user",
    query: "Need rollout guidance",
    scopes: ["policy_cards"],
    limits: { policy_cards: 10 },
  });

  assert.deepEqual(fetchedBotIds, ["ao"]);
  assert.equal(result.policyCards?.status, "found");
  if (result.policyCards?.status !== "found") return;
  assert.equal(result.policyCards.data.length, 3);
  assert.deepEqual(Object.keys(result.policyCards.data[0] ?? {}).sort(), [
    "appliesWhen",
    "policyCardId",
    "recommendedBehavior",
  ]);
});

test("rememberUserNote keeps a semantic duplicate without inserting it", async () => {
  const existing: UserNote = {
    id: 1,
    note: "Prefer concise answers",
    createdAt: new Date("2026-09-09T00:00:00.000Z"),
  };
  let inserts = 0;
  const service = createStubbedService(
    {
      searchUserNotes: async () => [existing],
      rememberUserNote: async () => {
        inserts += 1;
        return existing;
      },
    },
    [
      {
        destination: "user_memory",
        action: "keep_existing",
        targetNoteId: 1,
        reason: "semantic duplicate",
      },
    ],
  );

  const result = await service.rememberUserNote({
    userId: "shared-user",
    note: "Concise replies, please",
  });

  assert.equal(result.action, "keep_existing");
  assert.equal(result.note?.id, 1);
  assert.equal(inserts, 0);
});

test("replaceUserNote removes the old correction target from subsequent searches", async () => {
  const notes: UserNote[] = [
    {
      id: 1,
      note: "Prefer concise answers",
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
    },
  ];
  const service = createStubbedService(
    {
      searchUserNotes: async () => notes,
      replaceUserNote: async (_userId, noteId, note) => {
        const target = notes.find((item) => item.id === noteId);
        if (!target) return null;
        target.note = note;
        return target;
      },
    },
    [
      {
        destination: "user_memory",
        action: "replace",
        targetNoteId: 1,
        reason: "explicit correction",
      },
    ],
  );

  const result = await service.replaceUserNote({
    userId: "shared-user",
    noteId: 1,
    note: "Prefer detailed answers",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    (await service.searchUserNotes({ userId: "shared-user", query: "" })).map(
      (item) => item.note,
    ),
    ["Prefer detailed answers"],
  );
});

test("search ranks semantic UserMemory matches and does not expose scores", async () => {
  const service = createStubbedService(
    {
      fetchUserMemorySearchCandidates: async (userId) => {
        assert.equal(userId, "shared-user");
        return [
          {
            noteId: 1,
            userId,
            note: "I enjoy improvisational jazz",
            embedding: [1, 0],
            createdAt: new Date("2026-09-09T00:00:00.000Z"),
          },
          {
            noteId: 2,
            userId,
            note: "My preferred editor theme is dark",
            embedding: [0, 1],
            createdAt: new Date("2026-09-09T00:01:00.000Z"),
          },
        ];
      },
    },
    [],
    { embed: async () => [1, 0] },
  );

  const result = await service.search({
    botId: "ao",
    threadId: "thread-1",
    userId: "shared-user",
    query: "What kind of music do I like?",
    scopes: ["user_memory"],
  });

  assert.deepEqual(result.userMemory, {
    status: "found",
    data: [{ noteId: 1, note: "I enjoy improvisational jazz" }],
  });
  assert.equal(
    "score" in
      (result.userMemory?.status === "found"
        ? result.userMemory.data[0]!
        : {}),
    false,
  );
});

test("UserMemory search reports embedding failures as unavailable", async () => {
  const service = createStubbedService({});
  service.embedText = async () => {
    throw new Error("embedding service offline");
  };

  const result = await service.search({
    botId: "ao",
    threadId: "thread-1",
    userId: "shared-user",
    query: "music",
    scopes: ["user_memory"],
  });

  assert.deepEqual(result.userMemory, {
    status: "unavailable",
    reason: "embedding service offline",
  });
});

test("UserMemory create keeps the canonical write when indexing fails", async () => {
  let writes = 0;
  const service = createStubbedService(
    {
      rememberUserNote: async (_userId, note) => {
        writes += 1;
        return {
          id: 7,
          note,
          createdAt: new Date("2026-09-09T00:00:00.000Z"),
        };
      },
    },
    [{ destination: "user_memory", action: "create", reason: "new preference" }],
  );
  service.embedText = async () => {
    throw new Error("embedding service offline");
  };

  const result = await service.rememberUserNote({
    userId: "shared-user",
    note: "I like jazz",
  });

  assert.equal(result.ok, true);
  assert.equal(result.note?.id, 7);
  assert.equal(writes, 1);
});

test("replace and delete update the UserMemory search index", async () => {
  const deletedIndexIds: number[] = [];
  const indexed: UserMemorySearchIndexEntry[] = [];
  const existing = {
    id: 3,
    note: "Prefer concise answers",
    createdAt: new Date("2026-09-09T00:00:00.000Z"),
  };
  const service = createStubbedService(
    {
      searchUserNotes: async () => [existing],
      replaceUserNote: async (_userId, id, note) => ({ ...existing, id, note }),
      deleteUserNote: async () => true,
      deleteUserMemorySearchIndex: async (id) => {
        deletedIndexIds.push(id);
      },
      upsertUserMemorySearchIndex: async (entry) => {
        indexed.push(entry);
      },
    },
    [
      {
        destination: "user_memory",
        action: "replace",
        targetNoteId: 3,
        reason: "correction",
      },
    ],
  );
  service.embedText = async () => [0.5, 0.5];

  await service.replaceUserNote({
    userId: "shared-user",
    noteId: 3,
    note: "Prefer detailed answers",
  });
  await service.deleteUserNote({ userId: "shared-user", noteId: 3 });

  assert.deepEqual(deletedIndexIds, [3, 3]);
  assert.deepEqual(indexed, [
    {
      noteId: 3,
      userId: "shared-user",
      note: "Prefer detailed answers",
      embedding: [0.5, 0.5],
    },
  ]);
});

test("UserMemory index backfill is retryable and idempotent", async () => {
  const pending: UserNote[] = [
    {
      id: 5,
      note: "I like jazz",
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
    },
  ];
  const service = createStubbedService({
    fetchUnindexedUserNotes: async (userId) => {
      assert.equal(userId, "shared-user");
      return [...pending];
    },
    upsertUserMemorySearchIndex: async () => {
      pending.splice(0);
    },
  });
  service.embedText = async () => [1, 0];

  assert.equal(await service.backfillUserMemorySearchIndex("shared-user"), 1);
  assert.equal(await service.backfillUserMemorySearchIndex("shared-user"), 0);
});

test("DailyEvent service keeps user scope and structured date filters", async () => {
  const calls: Array<{
    userId: string;
    query: string;
    from?: string;
    to?: string;
  }> = [];
  const service = createStubbedService({
    searchDailyEvents: async (input) => {
      calls.push(input);
      return [];
    },
  });

  await service.searchDailyEvents({
    userId: "shared-user",
    query: "queue tests",
    from: "2026-09-01",
    to: "2026-09-30",
  });

  assert.deepEqual(calls, [
    {
      userId: "shared-user",
      query: "queue tests",
      from: "2026-09-01",
      to: "2026-09-30",
    },
  ]);
});

test("searchRelatedTurns applies scope filters and ranks semantic candidates", async () => {
  const requests: TurnRecordSearchRequest[] = [];
  const service = createStubbedService({
    fetchTurnSearchCandidates: async (input) => {
      requests.push(input);
      return [
        {
          turnRecordId: "old-music-turn",
          botId: "ao",
          threadId: "thread-1",
          kind: "human",
          roles: ["user", "assistant"],
          occurredAtIso: "2026-01-15T00:00:00.000Z",
          excerpt: "user: We talked about jazz records.",
          embedding: [1, 0],
        },
        {
          turnRecordId: "other-turn",
          botId: "ao",
          threadId: "thread-1",
          kind: "human",
          roles: ["user", "assistant"],
          occurredAtIso: "2026-01-16T00:00:00.000Z",
          excerpt: "user: Deployment notes.",
          embedding: [0, 1],
        },
      ];
    },
  });
  service.embedText = async () => [1, 0];

  const result = await service.searchRelatedTurns({
    botId: "ao",
    threadId: "thread-1",
    query: "What music did we discuss?",
    from: "2026-01-01",
    to: "2026-01-31",
    roles: ["user"],
    kinds: ["human"],
    limit: 1,
  });

  assert.equal(result[0]?.turnRecordId, "old-music-turn");
  assert.deepEqual(requests[0], {
    botId: "ao",
    threadId: "thread-1",
    query: "What music did we discuss?",
    from: "2026-01-01",
    to: "2026-01-31",
    roles: ["user"],
    kinds: ["human"],
    limit: 1,
  });
});

test("unified conversation search returns minimal TurnRecord payload", async () => {
  const service = createStubbedService({
    fetchTurnSearchCandidates: async () => [
      {
        turnRecordId: "old-music-turn",
        botId: "ao",
        threadId: "thread-1",
        kind: "human",
        roles: ["user", "assistant"],
        occurredAtIso: "2026-01-15T00:00:00.000Z",
        excerpt: "user: We talked about jazz records.",
        embedding: [1, 0],
      },
    ],
  });
  service.embedText = async () => [1, 0];

  const result = await service.search({
    botId: "ao",
    threadId: "thread-1",
    userId: "shared-user",
    query: "What music did we discuss?",
    scopes: ["conversation_history"],
  });

  assert.deepEqual(result.conversationHistory, {
    status: "found",
    data: [
      {
        turnRecordId: "old-music-turn",
        occurredAt: "2026-01-15T00:00:00.000Z",
        excerpt: "user: We talked about jazz records.",
      },
    ],
  });
});

test("backfillTurnSearchIndex is idempotent after indexing canonical turns", async () => {
  const record: TurnRecord = {
    botId: "ao",
    threadId: "thread-1",
    kind: "human",
    createdAtIso: "2026-01-15T00:00:00.000Z",
    messages: [
      {
        role: "user",
        content: "Do you remember our jazz discussion?",
        timestampIso: "2026-01-15T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "We compared several records.",
        timestampIso: "2026-01-15T00:00:01.000Z",
      },
    ],
  };
  const indexed: TurnSearchIndexEntry[] = [];
  let reads = 0;
  const service = createStubbedService({
    fetchUnindexedTurnRecords: async () => (reads++ === 0 ? [record] : []),
    upsertTurnSearchIndex: async (entry) => {
      indexed.push(entry);
    },
  });
  service.embedText = async (text) => [text.includes("kind: human") ? 1 : 0];

  assert.equal(await service.backfillTurnSearchIndex("ao"), 1);
  assert.equal(await service.backfillTurnSearchIndex("ao"), 0);
  assert.equal(indexed.length, 1);
  assert.deepEqual(indexed[0]?.roles, ["user", "assistant"]);
  assert.match(indexed[0]?.excerpt ?? "", /user:/);
});

const createStubbedService = (
  repositoryOverrides: Partial<RepositoryStub>,
  responses: unknown[] = [],
  embeddingProvider?: { embed(text: string): Promise<number[]> },
): StubbedService => {
  const service = createMemorySystemService({
    postgresUrl: "postgres://example.invalid",
    ollamaBaseUrl: "http://ollama.invalid",
    ollamaModel: "stub",
    ollamaAPIKey: "stub",
    embeddingProvider,
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
    rememberUserNote: async (_userId, note) => ({
      id: 1,
      note,
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
    }),
    searchUserNotes: async () => [],
    replaceUserNote: async () => null,
    deleteUserNote: async () => false,
    upsertUserMemorySearchIndex: async () => {},
    deleteUserMemorySearchIndex: async () => {},
    fetchUserMemorySearchCandidates: async () => [],
    fetchUnindexedUserNotes: async () => [],
    rememberDailyEvent: async (input) => ({
      id: 1,
      userId: input.userId,
      eventDate: input.eventDate,
      summary: input.summary,
      tags: [],
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
    }),
    searchDailyEvents: async () => [],
    getDailyEventsByDate: async () => [],
    upsertTurnSearchIndex: async () => {},
    fetchTurnSearchCandidates: async () => [],
    fetchUnindexedTurnRecords: async () => [],
    ...repositoryOverrides,
  };
  return service;
};
