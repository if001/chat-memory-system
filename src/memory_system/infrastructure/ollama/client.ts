import { z } from "zod";
import { JsonGeneratingClient } from "../../ports/jsonGeneratingClient";
import { except } from "drizzle-orm/gel-core";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ollamaChatResponseSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
});

export class OllamaClient implements JsonGeneratingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async generateJson<T>(
    schema: z.ZodType<T>,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ] satisfies ChatMessage[],
        format: z.toJSONSchema(schema),
        stream: false,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.log(
        "[generateJson] failed status=",
        response.status,
        "detail=",
        detail,
      );
      throw new Error(
        `ollama chat request failed: ${response.status}, ${detail}`,
      );
    }
    const raw_response = await response.json();
    try {
      const data = ollamaChatResponseSchema.parse(raw_response);
      return parseJsonResponse(data.message.content, schema);
    } catch (err) {
      console.log(
        "[buildPolicyHypothesisFromEpisodes] :raw_response",
        raw_response,
      );
      throw err;
    }
  }
}

const parseJsonResponse = <T>(raw: string, schema: z.ZodType<T>): T => {
  const normalized = unwrapJsonFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    const extracted = extractJsonCandidate(normalized);
    parsed = JSON.parse(extracted);
  }
  return schema.parse(parsed);
};

const unwrapJsonFence = (value: string): string => {
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return value;
};

const extractJsonCandidate = (value: string): string => {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const startCandidates = [objectStart, arrayStart].filter(
    (index) => index >= 0,
  );
  if (startCandidates.length === 0) {
    return value;
  }
  const start = Math.min(...startCandidates);
  const objectEnd = value.lastIndexOf("}");
  const arrayEnd = value.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  if (end < start) {
    return value.slice(start);
  }
  return value.slice(start, end + 1).trim();
};
