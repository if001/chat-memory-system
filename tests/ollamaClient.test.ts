import assert from "node:assert/strict";
import { test } from "vitest";
import { OllamaClient } from "../src/memory_system/infrastructure/ollama/client";
import { z } from "zod";

test("ollama json client rejects a response that does not match its declared type", async () => {
  let requestBody: unknown;
  const fetchFn: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({ value: ["not", "a", "string"] }),
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = new OllamaClient(
    "http://ollama.invalid",
    "test-model",
    undefined,
    fetchFn,
  );

  await assert.rejects(
    client.generateJson(z.object({ value: z.string() }), "system", "user"),
  );
  assert.deepEqual(requestBody, {
    model: "test-model",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user" },
    ],
    format: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    stream: false,
  });
});
