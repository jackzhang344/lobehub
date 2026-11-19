import { type ComfyUIKeyVault } from '@lobechat/types';
import { ModelRequestParametersSchema, resolveModelRequestParameters } from 'model-bank/aiModel';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { authedProcedure, router } from '@/libs/trpc/lambda';
// Import Framework layer services
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ImageService } from '@/server/services/comfyui/core/imageService';
import { ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import { WorkflowBuilderService } from '@/server/services/comfyui/core/workflowBuilderService';
import { type WorkflowContext } from '@/server/services/comfyui/types';

// ComfyUI params validation - only validate required fields
// Other RuntimeImageGenParams fields are passed through automatically
const ComfyUIParamsSchema = z
  .object({
    prompt: z.string(), // Only validate required fields
  })
  .passthrough();

/**
 * ComfyUI tRPC Router
 * Exposes Framework layer services to Runtime layer
 */
export const comfyuiRouter = router({
  /**
   * Create image with complete business logic
   */
  createImage: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        model: z.string(),
        options: z.custom<ComfyUIKeyVault>().optional(),
        params: ComfyUIParamsSchema,
        requestParameterOverrides: z.string().max(65_536).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { model, params, options = {}, requestParameterOverrides } = input;
      const overrides = requestParameterOverrides
        ? resolveModelRequestParameters(
            {
              customRequestParameters: ModelRequestParametersSchema.parse(
                Object.entries(JSON.parse(requestParameterOverrides)).map(([name, value]) => ({
                  name,
                  type: 'json',
                  value: JSON.stringify(value),
                })),
              ),
            },
            'comfyui',
          )
        : undefined;

      // Initialize Framework layer services
      const clientService = new ComfyUIClientService(options);
      const modelResolverService = new ModelResolverService(clientService);

      // Create workflow context
      const context: WorkflowContext = {
        clientService,
        modelResolverService,
      };

      const workflowBuilderService = new WorkflowBuilderService(context);

      // Initialize image service with all dependencies
      const imageService = new ImageService(
        clientService,
        modelResolverService,
        workflowBuilderService,
      );

      // Execute image creation
      return imageService.createImage(
        {
          model,
          params,
        },
        overrides,
      );
    }),

  /**
   * Get authentication headers for image downloads
   */
  getAuthHeaders: authedProcedure
    .input(
      z.object({
        options: z.custom<ComfyUIKeyVault>().optional(),
      }),
    )
    .query(async ({ input }) => {
      const clientService = new ComfyUIClientService(input.options || {});
      return clientService.getAuthHeaders();
    }),

  /**
   * Get available models
   */
  getModels: authedProcedure
    .input(
      z.object({
        options: z.custom<ComfyUIKeyVault>().optional(),
      }),
    )
    .query(async ({ input }) => {
      const clientService = new ComfyUIClientService(input.options || {});
      const modelResolverService = new ModelResolverService(clientService);

      return modelResolverService.getAvailableModelFiles();
    }),
});

export type ComfyUIRouter = typeof comfyuiRouter;
