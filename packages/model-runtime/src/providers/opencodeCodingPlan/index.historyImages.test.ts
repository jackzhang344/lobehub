// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload, UserMessageContentPart } from '../../types';
import { LobeOpenCodeCodingPlanAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const APP_URL = 'https://lobe.example.test';
const HISTORY_IMAGE = `${APP_URL}/f/file_example`;
const EXTERNAL_IMAGE = 'https://outside.example.test/f/file_example';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+TmOcAAAAASUVORK5CYII=';
const image = (url: string): UserMessageContentPart => ({
  image_url: { detail: 'low', url },
  type: 'image_url',
});

const simulateChat = async (
  model: string,
  messages: ChatStreamPayload['messages'],
  getImage = () => new Response(Buffer.from(PNG, 'base64')),
) => {
  vi.stubEnv('APP_URL', APP_URL);
  const bodies: ChatStreamPayload[] = [];
  const fetchMock = vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://models.dev/api.json') {
      return Response.json({ 'opencode-go': { models: {} } });
    }
    if (url === HISTORY_IMAGE) return getImage();
    if (url === 'https://opencode.ai/zen/go/v1/chat/completions') {
      bodies.push(JSON.parse(init?.body as string));
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    throw new Error('Unexpected network request');
  });
  vi.stubGlobal('fetch', fetchMock);
  const runtime = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });
  const response = await runtime.chat({ messages, model, stream: true });
  await response.text();
  return { body: bodies[0], fetchMock };
};

describe('OpenCode Go DeepSeek Flash history attachments', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends a site-hosted historical image inline alongside the latest text', async () => {
    const messages: ChatStreamPayload['messages'] = [
      { content: [image(HISTORY_IMAGE), image(HISTORY_IMAGE)], role: 'user' },
      { content: 'Earlier response', role: 'assistant' },
      { content: 'Continue', role: 'user' },
    ];
    const { body, fetchMock } = await simulateChat('deepseek-v4.1-flash', messages);
    const inline = image(`data:image/png;base64,${PNG}`);

    expect(body.messages[0].content).toEqual([inline, inline]);
    expect(body.messages.at(-1)?.content).toBe('Continue');
    expect(messages[0].content).toEqual([image(HISTORY_IMAGE), image(HISTORY_IMAGE)]);
    expect(fetchMock.mock.calls.filter(([url]) => url === HISTORY_IMAGE)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      HISTORY_IMAGE,
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('keeps external, already-inline, and unavailable images in their original form', async () => {
    const content = [image(EXTERNAL_IMAGE), image(`data:image/png;base64,${PNG}`), image(HISTORY_IMAGE)];
    const { body, fetchMock } = await simulateChat(
      'deepseek-v4.1-flash-1017',
      [{ content, role: 'user' }],
      () => new Response(null, { status: 404 }),
    );

    expect(body.messages[0].content).toEqual(content);
    expect(fetchMock.mock.calls.some(([url]) => url === EXTERNAL_IMAGE)).toBe(false);
  });

  it('leaves other models on the original upload path', async () => {
    const content = [image(HISTORY_IMAGE)];
    const { body, fetchMock } = await simulateChat('glm-5', [{ content, role: 'user' }]);

    expect(body.messages[0].content).toEqual(content);
    expect(fetchMock.mock.calls.some(([url]) => url === HISTORY_IMAGE)).toBe(false);
  });
});
