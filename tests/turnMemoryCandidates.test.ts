import assert from "node:assert/strict";
import { test } from "vitest";
import {
  classifyTurnMemoryCandidates,
  TurnRecord,
} from "../src";

const turn = (kind: TurnRecord["kind"] = "human"): TurnRecord => ({
  id: "turn-1",
  botId: "ao",
  threadId: "thread-1",
  kind,
  createdAtIso: "2026-09-09T00:00:00.000Z",
  messages: [
    {
      role: "user",
      content: "I always prefer jazz. I visited the museum on September 8.",
      timestampIso: "2026-09-09T00:00:00.000Z",
    },
    {
      role: "assistant",
      content: "The user likes classical music.",
      timestampIso: "2026-09-09T00:00:01.000Z",
    },
  ],
});

test("classifies durable facts and dated events from human messages only", async () => {
  let payload = "";
  const candidates = await classifyTurnMemoryCandidates(
    {
      generateJson: async (_systemPrompt, userPrompt) => {
        payload = userPrompt;
        return {
          candidates: [
            { kind: "user_memory", note: "  Prefers   jazz " },
            {
              kind: "daily_event",
              eventDate: "2026-09-08",
              summary: " Visited the museum ",
            },
            { kind: "daily_event", eventDate: "not-a-date", summary: "bad" },
            { kind: "none", note: "temporary" },
          ],
        };
      },
    },
    turn(),
  );

  assert.deepEqual(candidates, [
    { kind: "user_memory", note: "Prefers jazz" },
    {
      kind: "daily_event",
      eventDate: "2026-09-08",
      summary: "Visited the museum",
    },
  ]);
  assert.doesNotMatch(payload, /classical music/);
});

test.each(["proactive", "delegation"] as const)(
  "ignores %s turns without invoking classification",
  async (kind) => {
    let calls = 0;
    const candidates = await classifyTurnMemoryCandidates(
      {
        generateJson: async () => {
          calls += 1;
          return { candidates: [] };
        },
      },
      turn(kind),
    );
    assert.deepEqual(candidates, []);
    assert.equal(calls, 0);
  },
);

test("normalization makes repeated classification output deterministic", async () => {
  const model = {
    generateJson: async () => ({
      candidates: [
        { kind: "user_memory", note: "Prefers jazz" },
        { kind: "user_memory", note: "Prefers jazz" },
      ],
    }),
  };
  assert.deepEqual(
    await classifyTurnMemoryCandidates(model, turn()),
    await classifyTurnMemoryCandidates(model, turn()),
  );
});
