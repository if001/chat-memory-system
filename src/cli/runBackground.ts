import {
  createMemoryBackgroundRunner,
  createMemorySystemService,
} from "../index";

type MemoryBackgroundRunnerLike = {
  start(): void;
  stop(): void;
};

export interface RunBackgroundDependencies {
  createMemorySystemService: typeof createMemorySystemService;
  createMemoryBackgroundRunner: typeof createMemoryBackgroundRunner;
}

const defaultDependencies: RunBackgroundDependencies = {
  createMemorySystemService,
  createMemoryBackgroundRunner,
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

const optionalNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return value;
};

export const buildMemoryBackgroundRunnerFromEnv = (
  env: NodeJS.ProcessEnv,
  dependencies: RunBackgroundDependencies = defaultDependencies,
): {
  runner: MemoryBackgroundRunnerLike;
  meta: {
    botId: string;
    pollMs: number;
    threadLimit: number;
    turnLimitPerThread: number;
    episodeLimit: number;
    policyLimit: number;
  };
} => {
  const botId = env.BOT_ID ?? "ao";
  const pollMs = optionalNumberFromEnv(env, "MEMORY_BACKGROUND_POLL_MS", 5000);

  const service = dependencies.createMemorySystemService({
    postgresUrl: requiredFromEnv(env, "POSTGRES_URL"),
    ollamaBaseUrl: requiredFromEnv(env, "OLLAMA_BASE_URL"),
    ollamaModel: requiredFromEnv(env, "OLLAMA_CHAT_MODEL"),
    ollamaAPIKey: requiredFromEnv(env, "OLLAMA_API_KEY"),
    llmCacheDir: env.MEMORY_LLM_CACHE_DIR,
    llmCacheTtlMs: optionalNumberFromEnv(
      env,
      "MEMORY_LLM_CACHE_TTL_MS",
      24 * 60 * 60 * 1000,
    ),
    chunkSizeTurns: optionalNumberFromEnv(env, "MEMORY_CHUNK_SIZE_TURNS", 6),
    chunkOverlapTurns: optionalNumberFromEnv(env, "MEMORY_CHUNK_OVERLAP_TURNS", 2),
    policyQueryHistoryTurns: optionalNumberFromEnv(
      env,
      "MEMORY_POLICY_QUERY_HISTORY_TURNS",
      4,
    ),
  });

  const threadLimit = optionalNumberFromEnv(
    env,
    "MEMORY_BACKGROUND_THREAD_LIMIT",
    50,
  );
  const turnLimitPerThread = optionalNumberFromEnv(
    env,
    "MEMORY_BACKGROUND_TURN_LIMIT_PER_THREAD",
    200,
  );
  const episodeLimit = optionalNumberFromEnv(
    env,
    "MEMORY_BACKGROUND_EPISODE_LIMIT",
    50,
  );
  const policyLimit = optionalNumberFromEnv(
    env,
    "MEMORY_BACKGROUND_POLICY_LIMIT",
    50,
  );

  const runner = dependencies.createMemoryBackgroundRunner(service, {
    botId,
    pollMs,
    threadLimit,
    turnLimitPerThread,
    episodeLimit,
    policyLimit,
  });

  return {
    runner,
    meta: {
      botId,
      pollMs,
      threadLimit,
      turnLimitPerThread,
      episodeLimit,
      policyLimit,
    },
  };
};

const main = async (): Promise<void> => {
  const { runner, meta } = buildMemoryBackgroundRunnerFromEnv(process.env);

  process.stdout.write(
    `[memory-background] starting botId=${meta.botId} pollMs=${meta.pollMs}\n`,
  );
  runner.start();

  const shutdown = (): void => {
    process.stdout.write("[memory-background] stopping\n");
    runner.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

const requiredFromEnv = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

const optionalNumberFromEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number => {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return value;
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stdout.write(`${message}\n`);
    process.exit(1);
  });
}
