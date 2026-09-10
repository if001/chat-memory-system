import { MemorySystemService } from "./service";

export interface MemoryBackgroundRunnerOptions {
  botId: string;
  userId: string;
  pollMs?: number;
  threadLimit?: number;
  turnLimitPerThread?: number;
  chunkLimit?: number;
  episodeLimit?: number;
  policyLimit?: number;
  memoryCandidateBatchLimit?: number;
  memoryCandidateConcurrency?: number;
  memoryCandidateLeaseMs?: number;
}

export interface MemoryBackgroundRunner {
  start(): void;
  stop(): void;
  runOnce(): Promise<void>;
}

export const createMemoryBackgroundRunner = (
  service: Pick<
    MemorySystemService,
    | "listThreadIds"
    | "buildConversationChunksForThread"
    | "processPendingEpisodes"
    | "buildOrUpdatePolicyCards"
    | "processPendingTurnMemories"
  >,
  options: MemoryBackgroundRunnerOptions,
): MemoryBackgroundRunner => {
  const pollMs = options.pollMs ?? 5_000;
  const threadLimit = options.threadLimit ?? 50;
  const turnLimitPerThread = options.turnLimitPerThread ?? 200;
  const episodeLimit = options.episodeLimit ?? 20;
  const policyLimit = options.policyLimit ?? 20;
  const memoryCandidateBatchLimit = options.memoryCandidateBatchLimit ?? 20;
  const memoryCandidateConcurrency = options.memoryCandidateConcurrency ?? 2;
  const memoryCandidateLeaseMs = options.memoryCandidateLeaseMs ?? 5 * 60_000;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    console.log("[memory-background] cycle start");
    const threadIds = await service.listThreadIds(options.botId, threadLimit);
    console.log("[memory-background] threads", threadIds.length);
    for (const threadId of threadIds) {
      await service.buildConversationChunksForThread(
        options.botId,
        threadId,
        turnLimitPerThread,
      );
    }
    await service.processPendingTurnMemories({
      botId: options.botId,
      userId: options.userId,
      limit: memoryCandidateBatchLimit,
      concurrency: memoryCandidateConcurrency,
      leaseMs: memoryCandidateLeaseMs,
    });
    await service.processPendingEpisodes(options.botId, episodeLimit);
    await service.buildOrUpdatePolicyCards(options.botId, policyLimit);
    console.log("[memory-background] cycle complete");
  };

  const tick = (): void => {
    if (!running || inFlight) {
      return;
    }
    inFlight = runOnce()
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stdout.write(`[memory-background-error] ${message}\n`);
      })
      .finally(() => {
        inFlight = null;
      });
  };

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      timer = setInterval(tick, pollMs);
      timer.unref?.();
      tick();
    },
    stop(): void {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    async runOnce(): Promise<void> {
      await runOnce();
    },
  };
};
