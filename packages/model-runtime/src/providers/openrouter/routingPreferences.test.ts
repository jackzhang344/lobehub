// @vitest-environment node
import {
  type OpenRouterProviderPreferences,
  OpenRouterProviderPreferencesSchema,
} from 'model-bank/aiModel';
import { describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import { LobeOpenRouterAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

describe('OpenRouter model routing preferences', () => {
  it('sends the saved preferences only for the selected model, including when search changes the wire model ID', async () => {
    const preferences = OpenRouterProviderPreferencesSchema.parse({
      allow_fallbacks: true,
      max_price: { completion: 0.6, prompt: 0.15 },
      quantizations: ['fp8'],
      require_parameters: true,
      sort: { by: 'price', partition: null },
      zdr: true,
    });
    const configuredModel = 'deepseek/deepseek-v4.1-flash';
    let savedPreferences: OpenRouterProviderPreferences | undefined = preferences;
    const resolver = vi.fn(async (model: string) =>
      model === configuredModel ? savedPreferences : undefined,
    );
    const provider = new LobeOpenRouterAI({ apiKey: 'test' });
    const runtime = new ModelRuntime(provider, undefined, async (model) => {
      const value = await resolver(model);
      return value ? { provider: value } : undefined;
    });
    const create = vi
      .spyOn(provider['client'].chat.completions, 'create')
      .mockImplementation(async () => new ReadableStream() as any);
    const messages = [{ content: 'Hello', role: 'user' as const }];

    await runtime.chat({ enabledSearch: true, messages, model: configuredModel });
    await runtime.chat({ messages, model: 'openai/gpt-4' });
    savedPreferences = undefined;
    await runtime.chat({ messages, model: configuredModel });

    expect(resolver).toHaveBeenNthCalledWith(1, configuredModel);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: `${configuredModel}:online`,
      provider: preferences,
    });
    expect(create.mock.calls[1]?.[0]).not.toHaveProperty('provider');
    expect(create.mock.calls[2]?.[0]).not.toHaveProperty('provider');
  });

  it('rejects invalid prices and request fields outside the routing object', () => {
    expect(
      OpenRouterProviderPreferencesSchema.safeParse({ max_price: { prompt: -1 } }).success,
    ).toBe(false);
    expect(OpenRouterProviderPreferencesSchema.safeParse({ model: 'other/model' }).success).toBe(
      false,
    );
  });
});
