import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  createFileCachedJsonClient,
  JsonGeneratingClient,
} from "../src/memory_system/infrastructure/ollama/fileCachedClient";
import { z } from "zod";

const valueSchema = z.object({ value: z.string() });
const callSchema = z.object({ call: z.number() });

test("file cached json client reuses cached result for identical prompts", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "memory-llm-cache-"));
  let calls = 0;
  const inner: JsonGeneratingClient = {
    generateJson: async (schema) => {
      calls += 1;
      return schema.parse({ value: "cached-result" });
    },
  };
  const client = createFileCachedJsonClient(inner, { cacheDir });

  const first = await client.generateJson(valueSchema, "system", "user");
  const second = await client.generateJson(valueSchema, "system", "user");

  assert.deepEqual(first, { value: "cached-result" });
  assert.deepEqual(second, { value: "cached-result" });
  assert.equal(calls, 1);
});

test("file cached json client recomputes when ttl expires", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "memory-llm-cache-"));
  let calls = 0;
  const inner: JsonGeneratingClient = {
    generateJson: async (schema) => {
      calls += 1;
      return schema.parse({ call: calls });
    },
  };
  const client = createFileCachedJsonClient(inner, {
    cacheDir,
    ttlMs: 1,
  });

  const first = await client.generateJson(callSchema, "system", "user");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await client.generateJson(callSchema, "system", "user");

  assert.deepEqual(first, { call: 1 });
  assert.deepEqual(second, { call: 2 });
  assert.equal(calls, 2);
});

test("file cached json client rejects an invalid inner result", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "memory-llm-cache-"));
  const inner: JsonGeneratingClient = {
    generateJson: async () => ({ value: ["wrong type"] }) as never,
  };
  const client = createFileCachedJsonClient(inner, { cacheDir });

  await assert.rejects(
    client.generateJson(valueSchema, "system", "user"),
    /expected string, received array/,
  );
});

test("file cached json client isolates cache entries by schema", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "memory-llm-cache-"));
  let calls = 0;
  const inner: JsonGeneratingClient = {
    generateJson: async (schema) => {
      calls += 1;
      return schema.parse(calls === 1 ? { value: "first" } : { value: 2 });
    },
  };
  const client = createFileCachedJsonClient(inner, { cacheDir });

  assert.deepEqual(
    await client.generateJson(valueSchema, "system", "user"),
    { value: "first" },
  );
  assert.deepEqual(
    await client.generateJson(
      z.object({ value: z.number() }),
      "system",
      "user",
    ),
    { value: 2 },
  );
  assert.equal(calls, 2);
});
