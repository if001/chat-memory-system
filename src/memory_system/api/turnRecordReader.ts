import { TurnRecordReader } from "../domain/types";
import { MemoryRepository } from "../infrastructure/postgres/repository";

export interface ClosableTurnRecordReader extends TurnRecordReader {
  close(): Promise<void>;
}

export const createTurnRecordReader = (
  repository: Pick<MemoryRepository, "fetchRecentTurnRecordsForThread">,
): TurnRecordReader => ({
  listRecentTurnRecords: ({ botId, threadId, limit }) =>
    repository.fetchRecentTurnRecordsForThread(botId, threadId, limit),
});

export const createPostgresTurnRecordReader = (
  connectionString: string,
): ClosableTurnRecordReader => {
  const repository = new MemoryRepository(connectionString);
  return {
    ...createTurnRecordReader(repository),
    close: () => repository.close(),
  };
};
