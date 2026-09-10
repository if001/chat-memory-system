import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { JsonGeneratingClient } from "../../ports/jsonGeneratingClient";

export type { JsonGeneratingClient } from "../../ports/jsonGeneratingClient";

export interface FileCachedJsonClientOptions {
  cacheDir: string;
  ttlMs?: number;
}

interface CachedValueEnvelope {
  createdAtIso: string;
  value: unknown;
}

const cachedValueEnvelopeSchema = z.object({
  createdAtIso: z.string(),
  value: z.unknown(),
});

export const createFileCachedJsonClient = <TClient extends JsonGeneratingClient>(
  inner: TClient,
  options: FileCachedJsonClientOptions,
): JsonGeneratingClient => ({
  async generateJson<T>(
    schema: z.ZodType<T>,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<T> {
    const cachePath = join(
      options.cacheDir,
      `${buildCacheKey(schema, systemPrompt, userPrompt)}.json`,
    );
    const cached = await readCachedValue(cachePath, schema, options.ttlMs);
    if (cached.hit) {
      return cached.value;
    }

    const value = schema.parse(
      await inner.generateJson(schema, systemPrompt, userPrompt),
    );
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

const buildCacheKey = (
  schema: z.ZodType,
  systemPrompt: string,
  userPrompt: string,
): string =>
  createHash("sha256")
    .update(JSON.stringify(z.toJSONSchema(schema)))
    .update("\n---\n")
    .update(systemPrompt)
    .update("\n---\n")
    .update(userPrompt)
    .digest("hex");

const readCachedValue = async <T>(
  cachePath: string,
  schema: z.ZodType<T>,
  ttlMs?: number,
): Promise<{ hit: true; value: T } | { hit: false }> => {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = cachedValueEnvelopeSchema.parse(JSON.parse(raw));
    if (ttlMs && ttlMs > 0) {
      const createdAt = Date.parse(parsed.createdAtIso);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > ttlMs) {
        return { hit: false };
      }
    }
    const value = schema.safeParse(parsed.value);
    return value.success ? { hit: true, value: value.data } : { hit: false };
  } catch {
    return { hit: false };
  }
};
