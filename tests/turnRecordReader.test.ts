import assert from "node:assert/strict";
import { test } from "vitest";
import { createTurnRecordReader } from "../src/memory_system/api/turnRecordReader";
import { TurnRecord } from "../src/memory_system/domain/types";

test("reader exposes the canonical repository history without copying it", async () => {
  const records: TurnRecord[] = [
    {
      botId: "ao",
      threadId: "thread-1",
      kind: "human",
      messages: [],
      createdAtIso: "2026-08-31T00:00:00.000Z",
    },
  ];
  const calls: unknown[] = [];
  const reader = createTurnRecordReader({
    fetchRecentTurnRecordsForThread: async (botId, threadId, limit) => {
      calls.push({ botId, threadId, limit });
      return records;
    },
  });

  const result = await reader.listRecentTurnRecords({
    botId: "ao",
    threadId: "thread-1",
    limit: 12,
  });

  assert.equal(result, records);
  assert.deepEqual(calls, [{ botId: "ao", threadId: "thread-1", limit: 12 }]);
});
