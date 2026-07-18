interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

export interface TextEmbeddingClient {
  embed(text: string): Promise<number[]>;
}

export class OllamaEmbeddingClient implements TextEmbeddingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly expectedDimension?: number,
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async embed(text: string): Promise<number[]> {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }

    const response = await this.fetchFn(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: normalized,
      }),
    });
    if (!response.ok) {
      throw new Error(`ollama embed request failed: ${response.status}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    const vector = data.embeddings?.[0] ?? data.embedding ?? [];
    if (
      this.expectedDimension !== undefined &&
      vector.length > 0 &&
      vector.length !== this.expectedDimension
    ) {
      throw new Error(
        `ollama embed dimension mismatch: expected ${this.expectedDimension}, got ${vector.length}`,
      );
    }
    return vector;
  }
}
