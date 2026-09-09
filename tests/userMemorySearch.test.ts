import assert from "node:assert/strict";
import { test } from "vitest";
import { rankUserMemory } from "../src/memory_system/application/usecases/userMemorySearch";

test("hybrid ranking prioritizes semantic matches over unrelated notes", () => {
  const results = rankUserMemory("What music do I enjoy?", [1, 0], [
    {
      noteId: 1,
      userId: "user-1",
      note: "I enjoy improvisational jazz",
      embedding: [0.98, 0.02],
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
    },
    {
      noteId: 2,
      userId: "user-1",
      note: "My preferred editor theme is dark",
      embedding: [0, 1],
      createdAt: new Date("2026-09-09T00:01:00.000Z"),
    },
  ]);

  assert.deepEqual(results.map((result) => result.id), [1]);
});

test("hybrid ranking uses lexical overlap as an auxiliary signal", () => {
  const results = rankUserMemory("jazz music", [1, 0], [
    {
      noteId: 1,
      userId: "user-1",
      note: "jazz music is my favorite",
      embedding: [0.8, 0.6],
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
    },
    {
      noteId: 2,
      userId: "user-1",
      note: "I prefer instrumental recordings",
      embedding: [0.8, 0.6],
      createdAt: new Date("2026-09-09T00:01:00.000Z"),
    },
  ]);

  assert.deepEqual(results.map((result) => result.id), [1, 2]);
});
