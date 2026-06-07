import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  createFileCachedJsonClient,
  JsonGeneratingClient,
} from "../src/memory_system/infrastructure/ollama/fileCachedClient";

test("file cached json client reuses cached result for identical prompts", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "memory-llm-cache-"));
  let calls = 0;
  const inner: JsonGeneratingClient = {
    generateJson: async () => {
      calls += 1;
      return { value: "cached-result" };
    },
  };
  const client = createFileCachedJsonClient(inner, { cacheDir });

  const first = await client.generateJson<{ value: string }>("system", "user");
  const second = await client.generateJson<{ value: string }>("system", "user");

  assert.deepEqual(first, { value: "cached-result" });
  assert.deepEqual(second, { value: "cached-result" });
  assert.equal(calls, 1);
});

test("file cached json client recomputes when ttl expires", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "memory-llm-cache-"));
  let calls = 0;
  const inner: JsonGeneratingClient = {
    generateJson: async () => {
      calls += 1;
      return { call: calls };
    },
  };
  const client = createFileCachedJsonClient(inner, {
    cacheDir,
    ttlMs: 1,
  });

  const first = await client.generateJson<{ call: number }>("system", "user");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await client.generateJson<{ call: number }>("system", "user");

  assert.deepEqual(first, { call: 1 });
  assert.deepEqual(second, { call: 2 });
  assert.equal(calls, 2);
});
