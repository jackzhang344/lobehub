// @vitest-environment node
import { ModelRequestParametersSchema, resolveModelRequestParameters } from 'model-bank/aiModel';
import { describe, expect, it, vi } from 'vitest';

import { LobeAnthropicAI } from '../providers/anthropic';
import { LobeGoogleAI } from '../providers/google';
import { LobeOpenRouterAI } from '../providers/openrouter';
import { ModelRuntime } from './ModelRuntime';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const messages = [{ content: 'Hello', role: 'user' as const }];

describe('per-model request parameters', () => {
  it('passes four types, legacy routing and new fields to OpenRouter with API-native names', async () => {
    const config = {
      customRequestParameters: ModelRequestParametersSchema.parse([
        { name: 'temperature', type: 'number', value: 0 },
        { name: 'parallel_tool_calls', type: 'boolean', value: false },
        { name: 'service_tier', type: 'string', value: 'auto' },
        { name: 'provider', type: 'json', value: '{"zdr":true,"preferred_max_latency":2}' },
      ]),
      openRouterProvider: { sort: 'price' },
    };
    const bodies: Record<string, unknown>[] = [];
    const client = new LobeOpenRouterAI({
      apiKey: 'test',
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(init?.body as string));
        return Response.json({
          choices: [
            { finish_reason: 'stop', index: 0, message: { content: 'ok', role: 'assistant' } },
          ],
          created: 1,
          id: 'cmpl_fixture',
          model: 'provider/configured',
          object: 'chat.completion',
        });
      },
    });
    const runtime = new ModelRuntime(client, undefined, (model) =>
      resolveModelRequestParameters(
        model === 'provider/configured' ? config : undefined,
        'openrouter',
      ),
    );

    await runtime.chat({ messages, model: 'provider/configured', stream: false, temperature: 0.6 });
    await runtime.chat({ messages, model: 'provider/default', stream: false, temperature: 0.6 });
    expect(bodies[0]).toMatchObject({
      parallel_tool_calls: false,
      provider: { preferred_max_latency: 2, zdr: true },
      service_tier: 'auto',
      temperature: 0,
    });
    expect(bodies[1]).toMatchObject({ temperature: 0.6 });
    expect(bodies[1]).not.toHaveProperty('provider');
  });

  it('sends native Anthropic and Gemini fields at the API boundary', async () => {
    const claudeBodies: Record<string, unknown>[] = [];
    const claude = new LobeAnthropicAI({
      apiKey: 'test',
      fetch: async (_input: RequestInfo, init?: RequestInit) => {
        claudeBodies.push(JSON.parse(init?.body as string));
        return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    });
    const claudeRuntime = new ModelRuntime(claude, undefined, () => ({ top_k: 15 }));
    await claudeRuntime.chat({ messages, model: 'claude-sonnet-4-5' });
    expect(claudeBodies[0]).toMatchObject({ top_k: 15 });

    const geminiBodies: Record<string, unknown>[] = [];
    const gemini = new LobeGoogleAI({
      apiKey: 'test',
      baseURL: 'https://gemini.example.test',
    });
    // The SDK itself applies extraBody to the wire JSON; observe its fetch.
    vi.stubGlobal('fetch', async (_input: RequestInfo, init?: RequestInit) => {
      geminiBodies.push(JSON.parse(init?.body as string));
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"}}]}\n\n',
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    });
    try {
      const geminiRuntime = new ModelRuntime(gemini, undefined, () => ({
        generationConfig: { topK: 13 },
      }));
      await geminiRuntime.chat({ messages, model: 'gemini-2.5-flash', temperature: 0.4 });
      expect(geminiBodies[0]).toMatchObject({ generationConfig: { temperature: 0.4, topK: 13 } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects invalid JSON, duplicate names, and fields that the caller owns', () => {
    expect(
      ModelRequestParametersSchema.safeParse([
        { name: 'seed', type: 'number', value: 1 },
        { name: ' seed ', type: 'number', value: 2 },
      ]).success,
    ).toBe(false);
    expect(
      ModelRequestParametersSchema.safeParse([
        { name: 'provider', type: 'json', value: '{"sort": }' },
      ]).success,
    ).toBe(false);
    expect(
      ModelRequestParametersSchema.safeParse([{ name: 'messages', type: 'json', value: '[]' }])
        .success,
    ).toBe(false);
    expect(
      resolveModelRequestParameters({ openRouterProvider: { sort: 'price' } }, 'openrouter'),
    ).toEqual({ provider: { sort: 'price' } });
  });
});
