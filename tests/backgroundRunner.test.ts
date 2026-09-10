import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryBackgroundRunner } from "../src/memory_system/api/backgroundRunner";

const testBackgroundRunnerProcessesThreadsThenEpisodesThenPolicies = async (): Promise<void> => {
  const calls: string[] = [];

  const runner = createMemoryBackgroundRunner(
    {
      listThreadIds: async (botId, limit) => {
        calls.push(`listThreadIds:${botId}:${limit}`);
        return ["thread-a", "thread-b"];
      },
      buildConversationChunksForThread: async (botId, threadId, limit) => {
        calls.push(`buildConversationChunksForThread:${botId}:${threadId}:${limit}`);
        return [];
      },
      processPendingTurnMemories: async (input) => {
        calls.push(`processPendingTurnMemories:${input.botId}:${input.userId}:${input.limit}:${input.concurrency}:${input.leaseMs}`);
        return { selected: 0, claimed: 0, processed: 0, failed: 0 };
      },
      processPendingEpisodes: async (botId, limit) => {
        calls.push(`processPendingEpisodes:${botId}:${limit}`);
        return [];
      },
      buildOrUpdatePolicyCards: async (botId, limit) => {
        calls.push(`buildOrUpdatePolicyCards:${botId}:${limit}`);
        return [];
      },
    },
    {
      botId: "ao",
      userId: "user-1",
      threadLimit: 10,
      turnLimitPerThread: 40,
      episodeLimit: 15,
      policyLimit: 12,
      memoryCandidateBatchLimit: 7,
      memoryCandidateConcurrency: 3,
      memoryCandidateLeaseMs: 45_000,
    },
  );

  await runner.runOnce();

  assert.deepEqual(calls, [
    "listThreadIds:ao:10",
    "buildConversationChunksForThread:ao:thread-a:40",
    "buildConversationChunksForThread:ao:thread-b:40",
    "processPendingTurnMemories:ao:user-1:7:3:45000",
    "processPendingEpisodes:ao:15",
    "buildOrUpdatePolicyCards:ao:12",
  ]);
};

test(
  "background runner processes threads then episodes then policies",
  testBackgroundRunnerProcessesThreadsThenEpisodesThenPolicies,
);
