import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface JsonGeneratingClient {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export interface FileCachedJsonClientOptions {
  cacheDir: string;
  ttlMs?: number;
}

interface CachedValueEnvelope {
  createdAtIso: string;
  value: unknown;
}

export const createFileCachedJsonClient = <TClient extends JsonGeneratingClient>(
  inner: TClient,
  options: FileCachedJsonClientOptions,
): JsonGeneratingClient => ({
  async generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const cachePath = join(
      options.cacheDir,
      `${buildCacheKey(systemPrompt, userPrompt)}.json`,
    );
    const cached = await readCachedValue<T>(cachePath, options.ttlMs);
    if (cached.hit) {
      return cached.value;
    }

    const value = await inner.generateJson<T>(systemPrompt, userPrompt);
    await mkdir(options.cacheDir, { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          createdAtIso: new Date().toISOString(),
          value,
        } satisfies CachedValueEnvelope,
        null,
        2,
      ),
      "utf8",
    );
    return value;
  },
});

const buildCacheKey = (systemPrompt: string, userPrompt: string): string =>
  createHash("sha256")
    .update(systemPrompt)
    .update("\n---\n")
    .update(userPrompt)
    .digest("hex");

const readCachedValue = async <T>(
  cachePath: string,
  ttlMs?: number,
): Promise<{ hit: true; value: T } | { hit: false }> => {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as CachedValueEnvelope;
    if (ttlMs && ttlMs > 0) {
      const createdAt = Date.parse(parsed.createdAtIso);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > ttlMs) {
        return { hit: false };
      }
    }
    return { hit: true, value: parsed.value as T };
  } catch {
    return { hit: false };
  }
};
