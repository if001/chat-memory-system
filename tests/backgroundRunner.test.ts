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
      threadLimit: 10,
      turnLimitPerThread: 40,
      episodeLimit: 15,
      policyLimit: 12,
    },
  );

  await runner.runOnce();

  assert.deepEqual(calls, [
    "listThreadIds:ao:10",
    "buildConversationChunksForThread:ao:thread-a:40",
    "buildConversationChunksForThread:ao:thread-b:40",
    "processPendingEpisodes:ao:15",
    "buildOrUpdatePolicyCards:ao:12",
  ]);
};

test(
  "background runner processes threads then episodes then policies",
  testBackgroundRunnerProcessesThreadsThenEpisodesThenPolicies,
);
