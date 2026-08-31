import assert from "node:assert/strict";
import { test } from "vitest";
import { buildPolicyHypothesisFromEpisodes } from "../src/memory_system/application/usecases/buildPolicyCard";
import {
  buildConversationChunks,
  normalizeChunkingConfig,
} from "../src/memory_system/application/usecases/buildConversationChunks";
import { buildPolicyQueryContext } from "../src/memory_system/application/usecases/buildPolicyQueryContext";
import { decidePolicyCardUpdate } from "../src/memory_system/application/usecases/decidePolicyCardUpdate";
import { extractEpisodeCasesFromChunk } from "../src/memory_system/application/usecases/extractEpisodeCase";
import { filterApplicablePolicyCards } from "../src/memory_system/application/usecases/filterApplicablePolicyCards";
import { mergePolicyCardUpdate } from "../src/memory_system/application/usecases/mergePolicyCardUpdate";
import {
  applyEpisodeToPolicyCardFlow,
  createPolicyCardFlowCache,
  PolicyCardFlowPorts,
  PolicyFlowRecoverableError,
} from "../src/memory_system/application/usecases/policyCardFlow";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  PolicyEvaluation,
  PolicyHypothesis,
  TurnRecord,
} from "../src/memory_system/domain/types";

class JsonClientStub {
  readonly calls: Array<{ systemPrompt?: string; userPrompt?: string }> = [];

  constructor(private readonly queue: unknown[]) {}

  async generateJson<T>(systemPrompt?: string, userPrompt?: string): Promise<T> {
    this.calls.push({ systemPrompt, userPrompt });
    if (this.queue.length === 0) {
      throw new Error("stub queue is empty");
    }
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

const buildCard = (
  id: string,
  relatedEpisodeIds: string[],
  overrides: Partial<PolicyCard> = {},
): PolicyCard => ({
  id,
  botId: "ao",
  state: `card-state-${id}`,
  action: `card-action-${id}`,
  outcome: `card-outcome-${id}`,
  stateEmbeddingVector: [],
  actionEmbeddingVector: [],
  outcomeEmbeddingVector: [],
  relatedEpisodeIds,
  createdAtIso: "2026-07-18T00:00:00.000Z",
  lastUpdatedIso: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

const buildHypothesis = (
  episodes: EpisodeCase[],
  label: string,
): PolicyHypothesis => ({
  state: `${label}-state`,
  action: `${label}-action`,
  outcome: `${label}-outcome`,
  stateEmbeddingVector: [],
  actionEmbeddingVector: [],
  outcomeEmbeddingVector: [],
  relatedEpisodeIds: episodes.map((episode) => episode.id),
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
      source: "user",
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
      source: "simple_pomdp",
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
      source: "simple_pomdp",
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
      source: "user",
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
      id: "proactive-3",
      botId: "ao",
      threadId: "thread-1",
      source: "simple_pomdp",
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
    "proactive-1",
    "proactive-2",
    "user-2",
  ]);
  assert.doesNotMatch(chunks[0]?.chunkText ?? "", /background instruction/);
  assert.match(chunks[0]?.chunkText ?? "", /source=simple_pomdp/);
  assert.match(chunks[0]?.chunkText ?? "", /もう一点だけ共有します/);
  assert.doesNotMatch(chunks[0]?.chunkText ?? "", /未応答の働きかけ/);
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

test("buildPolicyHypothesisFromEpisodes normalizes state action outcome", async () => {
  const llm = new JsonClientStub([
    {
      state: "User is deciding an implementation approach.",
      action: "Assistant compares concrete options with constraints.",
      outcome: "A concrete next step becomes clear.",
    },
  ]);

  const result = await buildPolicyHypothesisFromEpisodes(llm, [
    buildEpisode("ep-1"),
    buildEpisode("ep-2"),
  ]);

  assert.equal(result.state, "User is deciding an implementation approach.");
  assert.deepEqual(result.relatedEpisodeIds, ["ep-1", "ep-2"]);
});

test("buildPolicyHypothesisFromEpisodes fills embeddings when embedder is provided", async () => {
  const llm = new JsonClientStub([
    {
      state: "State text",
      action: "Action text",
      outcome: "Outcome text",
    },
  ]);

  const result = await buildPolicyHypothesisFromEpisodes(
    llm,
    [buildEpisode("ep-1")],
    async (text) => [text.length],
  );

  assert.deepEqual(result.stateEmbeddingVector, ["State text".length]);
  assert.deepEqual(result.actionEmbeddingVector, ["Action text".length]);
  assert.deepEqual(result.outcomeEmbeddingVector, ["Outcome text".length]);
});

test("buildPolicyHypothesisFromEpisodes sends only episode text fields to llm", async () => {
  const llm = new JsonClientStub([
    {
      state: "Shared state",
      action: "Shared action",
      outcome: "Shared outcome",
    },
  ]);

  await buildPolicyHypothesisFromEpisodes(llm, [
    buildEpisode("ep-1", {
      stateEmbeddingVector: [1, 2, 3],
      actionEmbeddingVector: [4, 5, 6],
      outcomeEmbeddingVector: [7, 8, 9],
      relatedCardId: "pc-1",
    }),
  ]);

  const payload = JSON.parse(llm.calls[0]?.userPrompt ?? "{}") as {
    episodes: unknown[];
  };
  assert.deepEqual(payload.episodes, [
    {
      state: "state-ep-1",
      action: "action-ep-1",
      outcome: "outcome-ep-1",
    },
  ]);
});

test("decidePolicyCardUpdate sends only decision fields to llm", async () => {
  const llm = new JsonClientStub([
    {
      decision: "merge",
      reason: "Same behavior",
      targetPolicyCardId: "pc-1",
    },
  ]);

  await decidePolicyCardUpdate(
    llm,
    buildEpisode("ep-1", {
      stateEmbeddingVector: [1],
      actionEmbeddingVector: [2],
      outcomeEmbeddingVector: [3],
    }),
    [
      buildCard("pc-1", ["ep-older"], {
        stateEmbeddingVector: [4],
        actionEmbeddingVector: [5],
        outcomeEmbeddingVector: [6],
      }),
    ],
  );

  const payload = JSON.parse(llm.calls[0]?.userPrompt ?? "{}") as {
    episode: unknown;
    existingPolicyCards: unknown[];
  };
  assert.deepEqual(payload.episode, {
    state: "state-ep-1",
    action: "action-ep-1",
    outcome: "outcome-ep-1",
  });
  assert.deepEqual(payload.existingPolicyCards, [
    {
      id: "pc-1",
      state: "card-state-pc-1",
      action: "card-action-pc-1",
      outcome: "card-outcome-pc-1",
    },
  ]);
});

test("filterApplicablePolicyCards selects ids returned by the model", async () => {
  const llm = new JsonClientStub([["pc-2"]]);
  const cards = [
    buildCard("pc-1", []),
    buildCard("pc-2", []),
  ];

  const result = await filterApplicablePolicyCards(
    llm,
    "current implementation question",
    cards,
  );

  assert.deepEqual(
    result.map((card) => card.id),
    ["pc-2"],
  );
});

test("mergePolicyCardUpdate replaces content and unions episode ids", () => {
  const card = buildCard("pc-1", ["ep-1"], {
    state: "old-state",
    action: "old-action",
    outcome: "old-outcome",
  });

  const updated = mergePolicyCardUpdate(card, {
    state: "new-state",
    action: "new-action",
    outcome: "new-outcome",
    stateEmbeddingVector: [],
    actionEmbeddingVector: [],
    outcomeEmbeddingVector: [],
    relatedEpisodeIds: ["ep-1", "ep-2"],
  });

  assert.equal(updated.state, "new-state");
  assert.deepEqual(updated.relatedEpisodeIds, ["ep-1", "ep-2"]);
});

test("policyCardFlow merges into an existing card", async () => {
  const seed = buildEpisode("ep-seed");
  const incoming = buildEpisode("ep-new");
  const card = buildCard("pc-1", ["ep-seed"]);
  const ports: PolicyCardFlowPorts = {
    buildHypothesis: async (episodes) => buildHypothesis(episodes, "merged"),
    searchCards: async () => [card],
    evaluateEpisodes: async () => ({ consistent: true, clear: true }),
    evaluateSplit: async () => ({ consistent: false, clear: false }),
    clusterByState: async () => [],
    clusterByAction: async () => [],
  };

  const result = await applyEpisodeToPolicyCardFlow({
    botId: "ao",
    newEpisode: incoming,
    existingCards: [card],
    episodesByCardId: new Map([[card.id, [seed]]]),
    unassignedEpisodes: [],
    searchLimit: 3,
    ports,
  });

  assert.equal(result.outcome, "merged");
  assert.equal(result.updatedCards[0].id, "pc-1");
  assert.deepEqual(result.updatedCards[0].relatedEpisodeIds, ["ep-seed", "ep-new"]);
  assert.equal(result.stats.episodeEvalCalls, 1);
});

test("policyCardFlow creates a new card from unassigned cluster", async () => {
  const older = buildEpisode("ep-older", {
    state: "User asks for rollout guidance.",
    action: "Assistant proposes deployment steps.",
    outcome: "User gets an operational plan.",
  });
  const incoming = buildEpisode("ep-new", {
    state: "User asks for rollout guidance.",
    action: "Assistant proposes deployment steps.",
    outcome: "User gets a validated rollout path.",
  });
  const ports: PolicyCardFlowPorts = {
    buildHypothesis: async (episodes) => buildHypothesis(episodes, "created"),
    searchCards: async () => [],
    evaluateEpisodes: async () => ({ consistent: true, clear: true }),
    evaluateSplit: async () => ({ consistent: false, clear: false }),
    clusterByState: async (episodes) => [episodes],
    clusterByAction: async (episodes) => [episodes],
  };

  const result = await applyEpisodeToPolicyCardFlow({
    botId: "ao",
    newEpisode: incoming,
    existingCards: [],
    episodesByCardId: new Map(),
    unassignedEpisodes: [older],
    searchLimit: 3,
    ports,
  });

  assert.equal(result.outcome, "created");
  assert.deepEqual(result.assignedEpisodeIds.sort(), ["ep-new", "ep-older"]);
  assert.equal(result.updatedCards[0].relatedEpisodeIds.length, 2);
});

test("policyCardFlow splits a crowded card into two groups", async () => {
  const research = buildEpisode("ep-research", {
    state: "User wants research framing.",
    action: "Assistant frames the problem space.",
    outcome: "User gets a decision frame.",
  });
  const implementation = buildEpisode("ep-impl", {
    state: "User wants implementation detail.",
    action: "Assistant suggests concrete steps.",
    outcome: "User can implement immediately.",
  });
  const incoming = buildEpisode("ep-new", {
    state: "User wants research framing.",
    action: "Assistant frames the problem space.",
    outcome: "The framing stays separate from implementation work.",
  });
  const card = buildCard("pc-1", ["ep-research", "ep-impl"]);
  const ports: PolicyCardFlowPorts = {
    buildHypothesis: async (episodes) =>
      buildHypothesis(
        episodes,
        episodes.some((episode) => episode.id === "ep-impl")
          ? "implementation"
          : "research",
      ),
    searchCards: async () => [card],
    evaluateEpisodes: async () => ({ consistent: false, clear: false }),
    evaluateSplit: async () => ({ consistent: true, clear: true }),
    clusterByState: async () => [],
    clusterByAction: async () => [[research, incoming], [implementation]],
  };

  const result = await applyEpisodeToPolicyCardFlow({
    botId: "ao",
    newEpisode: incoming,
    existingCards: [card],
    episodesByCardId: new Map([[card.id, [research, implementation]]]),
    unassignedEpisodes: [],
    searchLimit: 3,
    ports,
  });

  assert.equal(result.outcome, "split");
  assert.equal(result.updatedCards[0].id, "pc-1");
  assert.deepEqual(result.updatedCards[0].relatedEpisodeIds, ["ep-impl"]);
  assert.deepEqual(
    [...result.updatedCards[1].relatedEpisodeIds].sort(),
    ["ep-new", "ep-research"],
  );
  assert.equal(result.stats.splitEvalCalls, 1);
});

test("policyCardFlow prunes supersets after a failed eval", async () => {
  const ep1 = buildEpisode("ep-1", { state: "same", action: "same" });
  const ep2 = buildEpisode("ep-2", { state: "same", action: "same" });
  const incoming = buildEpisode("ep-3", { state: "same", action: "same" });
  const evaluations: PolicyEvaluation[] = [{ consistent: false, clear: false }];
  let calls = 0;
  const cache = createPolicyCardFlowCache();
  const ports: PolicyCardFlowPorts = {
    buildHypothesis: async (episodes) => buildHypothesis(episodes, "pruned"),
    searchCards: async () => [],
    evaluateEpisodes: async () => {
      calls += 1;
      return evaluations[0]!;
    },
    evaluateSplit: async () => ({ consistent: false, clear: false }),
    clusterByState: async () => [[ep1, ep2, incoming]],
    clusterByAction: async () => [[ep1, incoming], [ep1, ep2, incoming]],
  };

  const result = await applyEpisodeToPolicyCardFlow({
    botId: "ao",
    newEpisode: incoming,
    existingCards: [],
    episodesByCardId: new Map(),
    unassignedEpisodes: [ep1, ep2],
    searchLimit: 3,
    ports,
    cache,
  });

  assert.equal(result.outcome, "unassigned");
  assert.equal(calls, 1);
  assert.equal(result.stats.episodeEvalCalls, 1);
  assert.equal(result.stats.cacheHits, 1);
});

test("policyCardFlow returns unassigned on recoverable llm error", async () => {
  const incoming = buildEpisode("ep-new");
  const ports: PolicyCardFlowPorts = {
    buildHypothesis: async () => {
      throw new PolicyFlowRecoverableError("llm failed");
    },
    searchCards: async () => [],
    evaluateEpisodes: async () => ({ consistent: true, clear: true }),
    evaluateSplit: async () => ({ consistent: true, clear: true }),
    clusterByState: async () => [],
    clusterByAction: async () => [],
  };

  const result = await applyEpisodeToPolicyCardFlow({
    botId: "ao",
    newEpisode: incoming,
    existingCards: [],
    episodesByCardId: new Map(),
    unassignedEpisodes: [],
    searchLimit: 3,
    ports,
  });

  assert.equal(result.outcome, "unassigned");
  assert.deepEqual(result.updatedCards, []);
  assert.deepEqual(result.assignedEpisodeIds, []);
  if (result.outcome === "unassigned") {
    assert.equal(result.recoverableError, true);
  }
});
