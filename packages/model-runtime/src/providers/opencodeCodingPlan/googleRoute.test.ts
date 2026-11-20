// @vitest-environment node
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenCodeCodingPlanAI } from './index';

// The router pulls the cloud model-bank config for deepseek route resolution,
// which transitively imports server-only modules (e.g. redis-client). Stub it
// so the Google chat route can be exercised in the node test env.
const { loadModelsMock } = vi.hoisted(() => ({ loadModelsMock: vi.fn() }));
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const modelsDevResponse = () =>
  new Response(
    JSON.stringify({
      'opencode-go': {
        models: {
          'gemini-4-argon': {
            id: 'gemini-4-argon',
            provider: {
              api: 'https://opencode.ai/inference/go/google/v1beta',
              npm: '@ai-sdk/google',
            },
            reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
          },
        },
      },
    }),
  );

async function* emptyGenerateContentStream(): AsyncGenerator<any> {}

describe('OpenCode Go Google route', () => {
  let generateContentStreamSpy: Mock;
  let chatCreateSpy: Mock;

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    vi.spyOn(global, 'fetch').mockImplementation(async () => modelsDevResponse());

    // All GoogleGenAI clients share the Models prototype, so spying on it
    // captures the router-created client's calls without mocking the SDK.
    const probe = new GoogleGenAI({ apiKey: 'test' });
    generateContentStreamSpy = vi
      .spyOn(Object.getPrototypeOf(probe.models), 'generateContentStream')
      .mockImplementation(async () => emptyGenerateContentStream()) as unknown as Mock;

    chatCreateSpy = vi
      .spyOn(OpenAI.Chat.Completions.prototype, 'create')
      .mockResolvedValue(new ReadableStream() as any) as unknown as Mock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends gemini-4-argon through generateContent with thinkingLevel and Go session headers', async () => {
    const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

    await instance.chat(
      {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gemini-4-argon',
        thinkingLevel: 'low',
      },
      { metadata: { topicId: 'topic-google' } },
    );

    expect(chatCreateSpy).not.toHaveBeenCalled();
    expect(generateContentStreamSpy).toHaveBeenCalledOnce();

    const request = generateContentStreamSpy.mock.calls[0][0];
    expect(request.model).toBe('gemini-4-argon');
    // Gemini 4 maps the thinkingLevel slider straight to thinkingConfig.
    expect(request.config.thinkingConfig).toMatchObject({
      includeThoughts: true,
      thinkingLevel: 'low',
    });
    // Go session identity reaches the Google route via per-request httpOptions.
    expect(request.config.httpOptions.headers).toMatchObject({
      'x-opencode-client': 'lobehub',
      'x-opencode-session': 'topic-google',
    });
  });
});
