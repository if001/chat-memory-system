import { z } from "zod";

export interface JsonGeneratingClient {
  generateJson<T>(
    schema: z.ZodType<T>,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<T>;
}
