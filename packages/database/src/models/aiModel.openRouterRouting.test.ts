// @vitest-environment node
import { eq } from 'drizzle-orm';
import { UpdateAiModelSchema } from 'model-bank/aiModel';
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

  await db.insert(users).values({ id: userId });
  try {
    await models.batchUpdateAiModels(provider, [model]);
    await models.update(
      model.id,
      provider,
      UpdateAiModelSchema.parse({
        config: { openRouterProvider },
      }),
    );

    await models.clearRemoteModels(provider);
    await models.batchUpdateAiModels(provider, [model]);
    expect((await models.findByIdAndProvider(model.id, provider))?.config).toMatchObject({
      openRouterProvider,
    });

    await models.update(
      model.id,
      provider,
      UpdateAiModelSchema.parse({
        config: { openRouterProvider: null },
      }),
    );
    expect((await models.findByIdAndProvider(model.id, provider))?.config).toMatchObject({
      openRouterProvider: null,
    });
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});
