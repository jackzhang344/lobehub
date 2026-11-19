// @vitest-environment node
import { eq } from 'drizzle-orm';
import {
  type ModelRequestParameters,
  resolveModelRequestParameters,
  UpdateAiModelSchema,
} from 'model-bank/aiModel';
import { expect, it, vi } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { users } from '../schemas';
import { AiModelModel } from './aiModel';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

it('preserves the model routing preferences when fetched metadata is refreshed and supports clearing them', async () => {
  const db = await getTestDB();
  const userId = 'openrouter-model-settings-test';
  const models = new AiModelModel(db, userId);
  const provider = 'openrouter';
  const model = {
    displayName: 'Example',
    enabled: true,
    id: 'example/chat',
    source: 'remote',
    type: 'chat',
  } as const;
  const openRouterProvider = { quantizations: ['fp8'], zdr: true };
  const customRequestParameters: ModelRequestParameters = [
    { name: 'provider', type: 'json', value: JSON.stringify(openRouterProvider) },
    { name: 'temperature', type: 'number', value: 0 },
  ];

  await db.insert(users).values({ id: userId });
  try {
    await models.batchUpdateAiModels(provider, [model]);
    await models.update(
      model.id,
      provider,
      UpdateAiModelSchema.parse({
        config: { customRequestParameters, openRouterProvider },
      }),
    );

    await models.clearRemoteModels(provider);
    await models.batchUpdateAiModels(provider, [model]);
    expect((await models.findByIdAndProvider(model.id, provider))?.config).toMatchObject({
      customRequestParameters,
      openRouterProvider,
    });

    await models.update(
      model.id,
      provider,
      UpdateAiModelSchema.parse({
        config: { customRequestParameters: [] },
      }),
    );
    const empty = (await models.findByIdAndProvider(model.id, provider))?.config;
    expect(empty).toMatchObject({ customRequestParameters: [], openRouterProvider });
    expect(resolveModelRequestParameters(empty as any, provider)).toBeUndefined();
    await models.clearRemoteModels(provider);
    await models.batchUpdateAiModels(provider, [model]);
    const refreshed = (await models.findByIdAndProvider(model.id, provider))?.config;
    expect(resolveModelRequestParameters(refreshed as any, provider)).toBeUndefined();
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});
