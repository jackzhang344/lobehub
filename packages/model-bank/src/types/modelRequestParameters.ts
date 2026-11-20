import { z } from 'zod';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// These fields are supplied by the caller or selected transport. Changing one
// can send a different conversation/model or break response parsing and billing.
const managedFields = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'model',
  'modelId',
  'messages',
  'input',
  'contents',
  'prompt',
  'stream',
  'stream_options',
  'stream_format',
  'file',
  'previous_response_id',
  'anthropic_version',
  'callback_url',
  'webhook_url',
  'encoding_format',
  'webhook_config',
  'api_version',
  'endpointUrl',
  'accessToken',
]);

const hasUnsafeJsonKey = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  Object.entries(value).some(
    ([key, child]) =>
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      hasUnsafeJsonKey(child),
  );

export const ModelRequestParameterNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((name) => !managedFields.has(name), 'This parameter is managed by LobeHub');

export const ModelRequestParametersSchema = z
  .array(
    z.discriminatedUnion('type', [
      z.object({
        name: ModelRequestParameterNameSchema,
        type: z.literal('string'),
        value: z.string(),
      }),
      z.object({
        name: ModelRequestParameterNameSchema,
        type: z.literal('number'),
        value: z.number(),
      }),
      z.object({
        name: ModelRequestParameterNameSchema,
        type: z.literal('boolean'),
        value: z.boolean(),
      }),
      z.object({
        name: ModelRequestParameterNameSchema,
        type: z.literal('json'),
        value: z.string().refine((value) => {
          try {
            return !hasUnsafeJsonKey(JSON.parse(value));
          } catch {
            return false;
          }
        }, 'Invalid JSON value'),
      }),
    ]),
  )
  .superRefine((rows, ctx) => {
    const names = new Set<string>();
    for (const [index, row] of rows.entries()) {
      if (names.has(row.name))
        ctx.addIssue({
          code: 'custom',
          message: 'Duplicate parameter name',
          path: [index, 'name'],
        });
      names.add(row.name);
    }
    if (new TextEncoder().encode(JSON.stringify(rows)).length > 65_536)
      ctx.addIssue({ code: 'custom', message: 'Custom parameters exceed 64 KiB' });
  });

export type ModelRequestParameters = z.infer<typeof ModelRequestParametersSchema>;
export type ModelRequestParameter = ModelRequestParameters[number];
export type ModelRequestParameterType = ModelRequestParameter['type'];
export type RequestBodyOverrides = Record<string, JsonValue>;

export interface ModelRequestParameterOptions {
  requestBodyOverrides?: RequestBodyOverrides;
}

export const resolveModelRequestParameters = (
  config:
    | { customRequestParameters?: ModelRequestParameters; openRouterProvider?: unknown }
    | null
    | undefined,
  provider: string,
): RequestBodyOverrides | undefined => {
  if (config?.customRequestParameters) {
    const rows = ModelRequestParametersSchema.parse(config.customRequestParameters);
    return rows.length
      ? Object.fromEntries(
          rows.map(({ name, type, value }) => [
            name,
            type === 'json' ? (JSON.parse(value) as JsonValue) : value,
          ]),
        )
      : undefined;
  }
  if (provider === 'openrouter' && config?.openRouterProvider) {
    const legacy = z.json().parse(config.openRouterProvider);
    if (!hasUnsafeJsonKey(legacy)) return { provider: legacy };
  }
};
