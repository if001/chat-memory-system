import assert from "node:assert/strict";
import { test } from "vitest";
import { buildPolicyHypothesisFromEpisodes } from "../src/memory_system/application/usecases/buildPolicyCard";
import {
  buildConversationChunks,
  normalizeChunkingConfig,
} from "../src/memory_system/application/usecases/buildConversationChunks";
import { buildPolicyQueryContext } from "../src/memory_system/application/usecases/buildPolicyQueryContext";
import {
  extractEpisodeCases,
  extractEpisodeCasesFromChunk,
} from "../src/memory_system/application/usecases/extractEpisodeCase";
import { filterApplicablePolicyCards } from "../src/memory_system/application/usecases/filterApplicablePolicyCards";
import { updatePolicyCardFromEpisode } from "../src/memory_system/application/usecases/updatePolicyCard";
import {
  EpisodeCase,
  PolicyCard,
  TurnRecord,
} from "../src/memory_system/domain/types";

class JsonClientStub {
  readonly calls: Array<{ systemPrompt?: string; userPrompt?: string }> = [];
  constructor(private readonly queue: unknown[]) {}
  async generateJson<T>(systemPrompt?: string, userPrompt?: string): Promise<T> {
    this.calls.push({ systemPrompt, userPrompt });
    if (this.queue.length === 0) throw new Error("stub queue is empty");
    return this.queue.shift() as T;
  }
}

const buildEpisode = (
  id: string,
  overrides: Partial<EpisodeCase> = {},
): EpisodeCase => ({
  id,
  botId: "ao",
  threadId: "thread-1",
  state: `state-${id}`,
  action: `action-${id}`,
  outcome: `outcome-${id}`,
  stateEmbeddingVector: [],
  actionEmbeddingVector: [],
  outcomeEmbeddingVector: [],
  createdAtIso: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

test("normalizeChunkingConfig applies defaults", () => {
  assert.deepEqual(normalizeChunkingConfig(undefined), {
    chunkSizeTurns: 6,
    chunkOverlapTurns: 2,
    agentInitiatedResponseMaxHours: 24,
  });
});

test("buildConversationChunks uses overlap windows", () => {
  const turns: TurnRecord[] = Array.from({ length: 5 }, (_, index) => ({
    id: `turn-${index + 1}`,
    botId: "ao",
    threadId: "thread-1",
    kind: "human",
    createdAtIso: `2026-07-18T00:0${index}:00.000Z`,
    messages: [
      {
        role: "user",
        content: `message-${index + 1}`,
        timestampIso: `2026-07-18T00:0${index}:00.000Z`,
      },
    ],
  }));

  const chunks = buildConversationChunks(turns, {
    chunkSizeTurns: 3,
    chunkOverlapTurns: 1,
  });

  assert.deepEqual(
    chunks.map((chunk) => chunk.turnRecordIds),
    [
      ["turn-1", "turn-2", "turn-3"],
      ["turn-3", "turn-4", "turn-5"],
    ],
  );
});

test("buildConversationChunks includes agent initiated turns only when a user responds in the window", () => {
  const turns: TurnRecord[] = [
    {
      id: "user-1",
      botId: "ao",
      threadId: "thread-1",
      kind: "human",
      createdAtIso: "2026-07-18T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "最初の相談",
          timestampIso: "2026-07-18T00:00:00.000Z",
        },
        {
          role: "assistant",
          content: "最初の回答",
          timestampIso: "2026-07-18T00:00:01.000Z",
        },
      ],
    },
    {
      id: "proactive-1",
      botId: "ao",
      threadId: "thread-1",
      kind: "proactive",
      sourceInteractionId: "interaction-1",
      createdAtIso: "2026-07-18T01:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "background instruction",
          timestampIso: "2026-07-18T01:00:00.000Z",
        },
        {
          role: "assistant",
          content: "補足すると、この観点もあります",
          timestampIso: "2026-07-18T01:00:01.000Z",
        },
      ],
    },
    {
      id: "proactive-2",
      botId: "ao",
      threadId: "thread-1",
      kind: "proactive",
      sourceInteractionId: "interaction-2",
      createdAtIso: "2026-07-18T02:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "background instruction",
          timestampIso: "2026-07-18T02:00:00.000Z",
        },
        {
          role: "assistant",
          content: "もう一点だけ共有します",
          timestampIso: "2026-07-18T02:00:01.000Z",
        },
      ],
    },
    {
      id: "user-2",
      botId: "ao",
      threadId: "thread-1",
      kind: "human",
      sourceInteractionId: "interaction-2",
      createdAtIso: "2026-07-18T03:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "それは気になります",
          timestampIso: "2026-07-18T03:00:00.000Z",
        },
        {
          role: "assistant",
          content: "では少し掘ります",
          timestampIso: "2026-07-18T03:00:01.000Z",
        },
      ],
    },
    {
      id: "delegation-1",
      botId: "ao",
      threadId: "thread-1",
      kind: "delegation",
      createdAtIso: "2026-07-18T03:30:00.000Z",
      messages: [
        {
          role: "user",
          content: "internal delegation instruction",
          timestampIso: "2026-07-18T03:30:00.000Z",
        },
      ],
    },
    {
      id: "proactive-3",
      botId: "ao",
      threadId: "thread-1",
      kind: "proactive",
      createdAtIso: "2026-07-18T04:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "background instruction",
          timestampIso: "2026-07-18T04:00:00.000Z",
        },
        {
          role: "assistant",
          content: "未応答の働きかけ",
          timestampIso: "2026-07-18T04:00:01.000Z",
        },
      ],
    },
  ];

  const chunks = buildConversationChunks(turns, {
    chunkSizeTurns: 4,
    chunkOverlapTurns: 1,
    agentInitiatedResponseMaxHours: 24,
  });

  assert.deepEqual(chunks[0]?.turnRecordIds, [
    "user-1",
    "proactive-2",
    "user-2",
  ]);
  assert.doesNotMatch(chunks[0]?.chunkText ?? "", /background instruction/);
  assert.match(chunks[0]?.chunkText ?? "", /kind=proactive/);
  assert.match(chunks[0]?.chunkText ?? "", /もう一点だけ共有します/);
  assert.doesNotMatch(chunks[0]?.chunkText ?? "", /未応答の働きかけ/);
  assert.doesNotMatch(chunks[0]?.chunkText ?? "", /internal delegation/);
});

test("extractEpisodeCases ignores proactive and delegation records", async () => {
  const llm = new JsonClientStub([]);
  const base: Omit<TurnRecord, "kind"> = {
    botId: "ao",
    threadId: "thread-1",
    messages: [
      {
        role: "user",
        content: "internal instruction",
        timestampIso: "2026-07-18T00:00:00.000Z",
      },
    ],
    createdAtIso: "2026-07-18T00:00:00.000Z",
  };

  assert.deepEqual(await extractEpisodeCases(llm, { ...base, kind: "proactive" }), []);
  assert.deepEqual(await extractEpisodeCases(llm, { ...base, kind: "delegation" }), []);
  assert.equal(llm.calls.length, 0);
});

test("buildPolicyQueryContext includes current input and recent turns", () => {
  const context = buildPolicyQueryContext("current ask", [
    {
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-07-18T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "older ask",
          timestampIso: "2026-07-18T00:00:00.000Z",
        },
        {
          role: "assistant",
          content: "older answer",
          timestampIso: "2026-07-18T00:00:01.000Z",
        },
      ],
    },
  ]);

  assert.match(context, /Current user input:/);
  assert.match(context, /Recent conversation history:/);
  assert.match(context, /\[assistant\] older answer/);
});

test("extractEpisodeCasesFromChunk extracts multiple episodes", async () => {
  const llm = new JsonClientStub([
    {
      episodes: [
        {
          state: "User compares webhook and polling.",
          action: "Assistant enumerates tradeoffs.",
          outcome: "User can choose an integration strategy.",
        },
        {
          state: "User asks about failure handling.",
          action: "Assistant proposes retries and alerting.",
          outcome: "Operational risk is clarified.",
        },
      ],
    },
  ]);
  const chunk: ConversationChunk = {
    id: "chunk-1",
    botId: "ao",
    threadId: "thread-1",
    turnRecordIds: ["turn-1"],
    startCreatedAtIso: "2026-07-18T00:00:00.000Z",
    endCreatedAtIso: "2026-07-18T00:01:00.000Z",
    chunkText: "conversation",
    turnCount: 1,
    tokenEstimate: 10,
    createdAtIso: "2026-07-18T00:02:00.000Z",
  };

  const episodes = await extractEpisodeCasesFromChunk(llm, chunk);

  assert.equal(episodes.length, 2);
  assert.equal(episodes[0]?.sourceChunkId, "chunk-1");
  assert.equal(episodes[1]?.action, "Assistant proposes retries and alerting.");
});

test("extractEpisodeCasesFromChunk fills embeddings when embedder is provided", async () => {
  const llm = new JsonClientStub([
    {
      episodes: [
        {
          state: "State text",
          action: "Action text",
          outcome: "Outcome text",
        },
      ],
    },
  ]);

  const episodes = await extractEpisodeCasesFromChunk(
    llm,
    {
      id: "chunk-1",
      botId: "ao",
      threadId: "thread-1",
      turnRecordIds: ["turn-1"],
      startCreatedAtIso: "2026-07-18T00:00:00.000Z",
      endCreatedAtIso: "2026-07-18T00:01:00.000Z",
      chunkText: "conversation",
      turnCount: 1,
      tokenEstimate: 10,
      createdAtIso: "2026-07-18T00:02:00.000Z",
    },
    async (text) => [text.length],
  );

  assert.deepEqual(episodes[0]?.stateEmbeddingVector, ["State text".length]);
  assert.deepEqual(episodes[0]?.actionEmbeddingVector, ["Action text".length]);
  assert.deepEqual(episodes[0]?.outcomeEmbeddingVector, ["Outcome text".length]);
});



test("buildPolicyHypothesisFromEpisodes produces only procedural policy fields", async () => {
  const llm = new JsonClientStub([{
    appliesWhen: "User is comparing implementation options.",
    recommendedBehavior: "Compare tradeoffs against explicit constraints.",
    avoidBehavior: "Do not choose an option without confirming constraints.",
  }]);

  const result = await buildPolicyHypothesisFromEpisodes(llm, [
    buildEpisode("ep-1"),
    buildEpisode("ep-2"),
  ]);

  assert.deepEqual(result, {
    appliesWhen: "User is comparing implementation options.",
    recommendedBehavior: "Compare tradeoffs against explicit constraints.",
    avoidBehavior: "Do not choose an option without confirming constraints.",
    episodeIds: ["ep-1", "ep-2"],
  });
  assert.doesNotMatch(JSON.stringify(result), /profile|interest|outcome/);
});

test("updatePolicyCardFromEpisode does not merge a different recommended behavior", async () => {
  const existing: PolicyCard = {
    id: "pc-1",
    botId: "ao",
    appliesWhen: "User asks for rollout guidance.",
    recommendedBehavior: "Provide a staged rollout checklist.",
    episodeIds: ["ep-1"],
    createdAtIso: "2026-07-18T00:00:00.000Z",
    lastUpdatedIso: "2026-07-18T00:00:00.000Z",
  };
  const incoming = buildEpisode("ep-2", {
    action: "Recommend an immediate rollback.",
  });
  const llm = new JsonClientStub([{ decision: "create" }]);

  const result = await updatePolicyCardFromEpisode({
    llm,
    botId: "ao",
    episode: incoming,
    existingCards: [existing],
    episodesByCardId: new Map([["pc-1", [buildEpisode("ep-1")]]]),
    buildHypothesis: async () => ({
      appliesWhen: "User asks about an active production incident.",
      recommendedBehavior: "Recommend an immediate rollback.",
      episodeIds: ["ep-2"],
    }),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
  });

  assert.notEqual(result.id, existing.id);
  assert.deepEqual(result.episodeIds, ["ep-2"]);
  assert.match(llm.calls[0]?.systemPrompt ?? "", /推奨行動が異なる場合/);
});

test("filterApplicablePolicyCards returns only model-selected evidenced policy", async () => {
  const evidenced: PolicyCard = {
    id: "pc-1",
    botId: "ao",
    appliesWhen: "User compares implementation options.",
    recommendedBehavior: "Compare tradeoffs.",
    episodeIds: ["ep-1"],
    createdAtIso: "2026-07-18T00:00:00.000Z",
    lastUpdatedIso: "2026-07-18T00:00:00.000Z",
  };
  const result = await filterApplicablePolicyCards(
    new JsonClientStub([["pc-1"]]),
    "User asks webhook or polling",
    [evidenced],
  );
  assert.deepEqual(result, [evidenced]);
});
