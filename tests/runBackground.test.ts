import assert from "node:assert/strict";
import { test } from "vitest";
import { buildMemoryBackgroundRunnerFromEnv } from "../src/cli/runBackground";

test("buildMemoryBackgroundRunnerFromEnv wires service and runner config", () => {
  let serviceInput: unknown;
  let runnerInput: unknown;
  const built = buildMemoryBackgroundRunnerFromEnv(
    {
      BOT_ID: "ao",
      MEMORY_BACKGROUND_USER_ID: "user-1",
      POSTGRES_URL: "postgres://example",
      OLLAMA_BASE_URL: "http://ollama.local",
      OLLAMA_CHAT_MODEL: "qwen3",
      OLLAMA_API_KEY: "secret",
      OLLAMA_EMBEDDING_BASE_URL: "http://embed.local",
      OLLAMA_EMBEDDING_MODEL: "nomic-embed-text",
      OLLAMA_EMBEDDING_DIMENSION: "768",
      MEMORY_BACKGROUND_POLL_MS: "7000",
      MEMORY_BACKGROUND_THREAD_LIMIT: "12",
      MEMORY_BACKGROUND_TURN_LIMIT_PER_THREAD: "90",
      MEMORY_BACKGROUND_EPISODE_LIMIT: "11",
      MEMORY_BACKGROUND_POLICY_LIMIT: "8",
      MEMORY_CANDIDATE_BATCH_LIMIT: "9",
      MEMORY_CANDIDATE_CONCURRENCY: "3",
      MEMORY_CANDIDATE_LEASE_MS: "45000",
      MEMORY_LLM_CACHE_DIR: "/tmp/memory-cache",
      MEMORY_LLM_CACHE_TTL_MS: "60000",
      MEMORY_CHUNK_SIZE_TURNS: "5",
      MEMORY_CHUNK_OVERLAP_TURNS: "1",
      MEMORY_AGENT_INITIATED_RESPONSE_MAX_HOURS: "12",
      MEMORY_POLICY_QUERY_HISTORY_TURNS: "6",
    },
    {
      createMemorySystemService: ((input) => {
        serviceInput = input;
        return {} as never;
      }) as never,
      createMemoryBackgroundRunner: ((service, config) => {
        runnerInput = { service, config };
        return { start() {}, stop() {}, runOnce: async () => {} } as never;
      }) as never,
    },
  );

  assert.equal(built.meta.pollMs, 7000);
  assert.equal(built.meta.userId, "user-1");
  assert.deepEqual(serviceInput, {
    postgresUrl: "postgres://example",
    ollamaBaseUrl: "http://ollama.local",
    ollamaModel: "qwen3",
    ollamaAPIKey: "secret",
    ollamaEmbeddingBaseUrl: "http://embed.local",
    ollamaEmbeddingModel: "nomic-embed-text",
    ollamaEmbeddingDimension: 768,
    llmCacheDir: "/tmp/memory-cache",
    llmCacheTtlMs: 60000,
    chunkSizeTurns: 5,
    chunkOverlapTurns: 1,
    agentInitiatedResponseMaxHours: 12,
    policyQueryHistoryTurns: 6,
  });
  assert.deepEqual(runnerInput, {
    service: {} as never,
    config: {
      botId: "ao",
      userId: "user-1",
      pollMs: 7000,
      threadLimit: 12,
      turnLimitPerThread: 90,
      episodeLimit: 11,
      policyLimit: 8,
      memoryCandidateBatchLimit: 9,
      memoryCandidateConcurrency: 3,
      memoryCandidateLeaseMs: 45000,
    },
  });
});

test("buildMemoryBackgroundRunnerFromEnv throws on missing required env", () => {
  assert.throws(
    () =>
      buildMemoryBackgroundRunnerFromEnv({
        BOT_ID: "ao",
        MEMORY_BACKGROUND_USER_ID: "user-1",
        POSTGRES_URL: "postgres://example",
        OLLAMA_BASE_URL: "http://ollama.local",
        OLLAMA_API_KEY: "secret",
      }),
    /Missing environment variable: OLLAMA_CHAT_MODEL/,
  );
});

test("buildMemoryBackgroundRunnerFromEnv throws on invalid numeric env", () => {
  assert.throws(
    () =>
      buildMemoryBackgroundRunnerFromEnv({
        BOT_ID: "ao",
        MEMORY_BACKGROUND_USER_ID: "user-1",
        POSTGRES_URL: "postgres://example",
        OLLAMA_BASE_URL: "http://ollama.local",
        OLLAMA_CHAT_MODEL: "qwen3",
        OLLAMA_API_KEY: "secret",
        MEMORY_BACKGROUND_POLL_MS: "abc",
      }),
    /Invalid numeric environment variable: MEMORY_BACKGROUND_POLL_MS/,
  );
});

test("buildMemoryBackgroundRunnerFromEnv reuses the simple-pomdp user scope", () => {
  const built = buildMemoryBackgroundRunnerFromEnv(
    {
      BOT_ID: "ao",
      SIMPLE_POMDP_USER_ID: "shared-user",
      POSTGRES_URL: "postgres://example",
      OLLAMA_BASE_URL: "http://ollama.local",
      OLLAMA_CHAT_MODEL: "qwen3",
      OLLAMA_API_KEY: "secret",
    },
    {
      createMemorySystemService: (() => ({})) as never,
      createMemoryBackgroundRunner: (() => ({
        start() {},
        stop() {},
        runOnce: async () => {},
      })) as never,
    },
  );

  assert.equal(built.meta.userId, "shared-user");
});
