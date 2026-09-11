import { OllamaEmbeddingClient } from "../memory_system/infrastructure/ollama/embeddingClient";
import { MemoryRepository } from "../memory_system/infrastructure/postgres/repository";

const EMBEDDING_DIMENSION = 768;

const requiredFromEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const positiveIntegerFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const configuredDimension = positiveIntegerFromEnv(
    "OLLAMA_EMBEDDING_DIMENSION",
    EMBEDDING_DIMENSION,
  );
  if (configuredDimension !== EMBEDDING_DIMENSION) {
    throw new Error(
      `OLLAMA_EMBEDDING_DIMENSION must be ${EMBEDDING_DIMENSION}`,
    );
  }
  const repository = new MemoryRepository(requiredFromEnv("POSTGRES_URL"));
  const embeddingClient = new OllamaEmbeddingClient(
    process.env.OLLAMA_EMBEDDING_BASE_URL ?? requiredFromEnv("OLLAMA_BASE_URL"),
    requiredFromEnv("OLLAMA_EMBEDDING_MODEL"),
    EMBEDDING_DIMENSION,
    process.env.OLLAMA_API_KEY,
  );
  const batchSize = positiveIntegerFromEnv(
    "MEMORY_USER_NOTE_BACKFILL_BATCH_SIZE",
    100,
  );
  let indexedTotal = 0;

  try {
    while (true) {
      const pending =
        await repository.fetchUnindexedUserNotesAcrossUsers(batchSize);
      if (pending.length === 0) break;

      let indexedInBatch = 0;
      for (const { note } of pending) {
        try {
          const embedding = await embeddingClient.embed(note.note);
          await repository.upsertUserMemorySearchIndex({
            noteId: note.id,
            embedding,
          });
          indexedInBatch += 1;
          indexedTotal += 1;
        } catch (error: unknown) {
          const detail =
            error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `[user-memory-backfill-error] noteId=${note.id} detail=${detail}\n`,
          );
        }
      }

      process.stdout.write(
        `[user-memory-backfill] indexed=${indexedTotal} pendingBatch=${pending.length}\n`,
      );
      if (indexedInBatch === 0) {
        throw new Error("Backfill made no progress; failed notes remain unindexed");
      }
    }
    process.stdout.write(
      `[user-memory-backfill] complete indexed=${indexedTotal}\n`,
    );
  } finally {
    await repository.close();
  }
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
