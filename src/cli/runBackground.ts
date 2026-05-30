import {
  createMemoryBackgroundRunner,
  createMemorySystemService,
} from "../index";

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

const main = async (): Promise<void> => {
  const botId = process.env.BOT_ID ?? "ao";
  const pollMs = optionalNumber("MEMORY_BACKGROUND_POLL_MS", 5000);

  const service = createMemorySystemService({
    postgresUrl: required("POSTGRES_URL"),
    ollamaBaseUrl: required("OLLAMA_BASE_URL"),
    ollamaModel: required("OLLAMA_CHAT_MODEL"),
    chunkSizeTurns: optionalNumber("MEMORY_CHUNK_SIZE_TURNS", 6),
    chunkOverlapTurns: optionalNumber("MEMORY_CHUNK_OVERLAP_TURNS", 2),
    policyQueryHistoryTurns: optionalNumber("MEMORY_POLICY_QUERY_HISTORY_TURNS", 4),
  });

  const runner = createMemoryBackgroundRunner(service, {
    botId,
    pollMs,
    threadLimit: optionalNumber("MEMORY_BACKGROUND_THREAD_LIMIT", 50),
    turnLimitPerThread: optionalNumber(
      "MEMORY_BACKGROUND_TURN_LIMIT_PER_THREAD",
      200,
    ),
    episodeLimit: optionalNumber("MEMORY_BACKGROUND_EPISODE_LIMIT", 50),
    policyLimit: optionalNumber("MEMORY_BACKGROUND_POLICY_LIMIT", 50),
  });

  process.stdout.write(
    `[memory-background] starting botId=${botId} pollMs=${pollMs}\n`,
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

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stdout.write(`${message}\n`);
  process.exit(1);
});
