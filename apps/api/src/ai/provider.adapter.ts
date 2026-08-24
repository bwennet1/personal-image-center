export interface AiProviderAdapter {
  readonly name: string;
  readonly configured: boolean;
  analyze(_input: { assetId: string; bytes: Buffer }): Promise<{ tags: string[]; description?: string }>;
}

/** Cloud AI is optional. Core library never depends on this succeeding. */
export class UnconfiguredAiAdapter implements AiProviderAdapter {
  readonly name = "unconfigured";
  readonly configured = false;
  async analyze(): Promise<{ tags: string[]; description?: string }> {
    return { tags: [] };
  }
}
