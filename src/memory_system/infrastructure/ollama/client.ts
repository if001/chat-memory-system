interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
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
        format: "json",
        stream: false,
      }),
    });
    if (!response.ok) {
      const err = await response.json();
      console.log("[generateJson] err:", err);
      throw new Error(`ollama chat request failed: ${response.status}, ${err}`);
    }
    const data = (await response.json()) as OllamaChatResponse;
    const raw = data.message?.content ?? "{}";
    return parseJsonResponse<T>(raw);
  }
}

const parseJsonResponse = <T>(raw: string): T => {
  const normalized = unwrapJsonFence(raw.trim());
  try {
    return JSON.parse(normalized) as T;
  } catch {
    const extracted = extractJsonCandidate(normalized);
    return JSON.parse(extracted) as T;
  }
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
