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
      throw new Error(`ollama chat request failed: ${response.status}`);
    }
    const data = (await response.json()) as OllamaChatResponse;
    const raw = data.message?.content ?? "{}";
    return JSON.parse(raw) as T;
  }
}
