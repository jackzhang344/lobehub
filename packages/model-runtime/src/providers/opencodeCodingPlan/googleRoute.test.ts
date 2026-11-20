// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import { LobeOpenCodeCodingPlanAI } from './index';

// The router pulls the cloud model-bank config for deepseek route resolution,
// which transitively imports server-only modules (e.g. redis-client). Stub it
// so the Google chat route can be exercised in the node test env.
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
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

describe('OpenCode Go Google route', () => {
  it('sends Gemini thinking level, session headers, and saved request parameters together', async () => {
    const requests: { body: unknown; headers: Headers; url: URL }[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input === 'https://models.dev/api.json') return modelsDevResponse();

      requests.push({
        body: JSON.parse(init?.body as string),
        headers: new Headers(init?.headers),
        url: new URL(input),
      });
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"}}]}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });

    try {
      const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });
      const runtime = new ModelRuntime(instance, undefined, () => ({
        generationConfig: { maxOutputTokens: 1024 },
      }));
      const response = await runtime.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gemini-4-argon',
          thinkingLevel: 'low',
        },
        { metadata: { topicId: 'topic-google' } },
      );
      await response.text();

      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request.url.origin).toBe('https://opencode.ai');
      expect(request.url.pathname).toBe(
        '/inference/go/google/v1beta/models/gemini-4-argon:streamGenerateContent',
      );
      expect(request.headers.get('x-opencode-client')).toBe('lobehub');
      expect(request.headers.get('x-opencode-session')).toBe('topic-google');
      expect(request.body).toMatchObject({
        generationConfig: {
          maxOutputTokens: 1024,
          thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' },
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
