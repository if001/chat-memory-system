import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MemoryClientFacade,
  MemoryResult,
  MemorySearchRequest,
  MemorySearchResult,
  validateMemorySearchRequest,
} from "../src";

const request = (
  overrides: Partial<MemorySearchRequest> = {},
): MemorySearchRequest => ({
  botId: "ao",
  threadId: "discord-channel-1",
  userId: "discord-user-1",
  query: "What music does the user like?",
  scopes: ["user_memory"],
  ...overrides,
});

test("public facade keeps caller scope while hiding storage details", async () => {
  const calls: string[] = [];
  const facade: MemoryClientFacade = {
    recordTurn: async (input) => {
      calls.push(`turn:${input.botId}:${input.threadId}`);
    },
    inspectCatalog: async (input) => ({
      status: "available",
      conversationHistory: { status: "available", available: true, topics: [input.threadId] },
      userMemory: { status: "available", available: true, topics: [input.userId] },
      dailyEvents: { status: "empty", available: false, topics: [] },
      policyCards: { status: "available", available: true, topics: [input.botId] },
    }),
    search: async (input): Promise<MemorySearchResult> => ({
      userMemory: {
        status: "found",
        data: [{ noteId: 1, note: `${input.userId}: jazz` }],
      },
    }),
    queryApplicablePolicyCards: async () => [],
    rememberUserNote: async () => ({ ok: true }),
    searchUserNotes: async () => [],
    replaceUserNote: async () => ({ ok: true }),
    deleteUserNote: async () => true,
    rememberDailyEvent: async (input) => ({
      id: 1,
      userId: input.userId,
      eventDate: input.eventDate,
      summary: input.summary,
      tags: input.tags ?? [],
      createdAt: new Date(),
    }),
    searchDailyEvents: async () => [],
    getDailyEventsByDate: async () => [],
    searchRelatedTurns: async () => [],
    backfillTurnSearchIndex: async () => 0,
  };

  const catalog = await facade.inspectCatalog({
    botId: "ao",
    threadId: "discord-channel-1",
    userId: "discord-user-1",
  });
  const result = await facade.search(request());
  await facade.recordTurn({
    botId: "ao",
    threadId: "discord-channel-1",
    kind: "human",
    messages: [],
    createdAtIso: "2026-09-09T00:00:00.000Z",
  });
  assert.deepEqual(
    await facade.queryApplicablePolicyCards({
      botId: "ao",
      threadId: "discord-channel-1",
      currentContext: "rollout",
    }),
    [],
  );

  assert.equal(catalog.conversationHistory.topics[0], "discord-channel-1");
  assert.equal(catalog.userMemory.topics[0], "discord-user-1");
  assert.deepEqual(result.userMemory, {
    status: "found",
    data: [{ noteId: 1, note: "discord-user-1: jazz" }],
  });
  assert.deepEqual(calls, ["turn:ao:discord-channel-1"]);
});

test.each<MemoryResult<string[]>>([
  { status: "found", data: ["memory"] },
  { status: "not_found" },
  { status: "unavailable", reason: "backend timeout" },
])("memory lookup status survives JSON serialization: $status", (result) => {
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("validates bot, thread, and user scoped search requests", () => {
  const valid = request({
    scopes: ["conversation_history", "user_memory", "policy_cards"],
    limits: { conversation_history: 10, user_memory: 5 },
  });
  assert.equal(validateMemorySearchRequest(valid), valid);

  assert.throws(
    () => validateMemorySearchRequest(request({ botId: " " })),
    /botId must not be empty/,
  );
  assert.throws(
    () => validateMemorySearchRequest(request({ threadId: "" })),
    /threadId must not be empty/,
  );
  assert.throws(
    () => validateMemorySearchRequest(request({ userId: "" })),
    /userId must not be empty/,
  );
  assert.throws(
    () => validateMemorySearchRequest(request({ scopes: [] })),
    /at least one memory scope/,
  );
  assert.throws(
    () =>
      validateMemorySearchRequest(
        request({ scopes: ["user_memory", "user_memory"] }),
      ),
    /must not contain duplicates/,
  );
  assert.throws(
    () =>
      validateMemorySearchRequest(
        request({ scopes: ["unknown" as "user_memory"] }),
      ),
    /unknown memory scope/,
  );
  assert.throws(
    () => validateMemorySearchRequest(request({ limits: { user_memory: 0 } })),
    /positive integer/,
  );
});
