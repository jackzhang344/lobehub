import type { FormValues } from '@lobehub/ui/form';
import {
  type AiModelConfig,
  ModelRequestParametersSchema,
  type ModelRequestParameterType,
  type UpdateAiModelParams,
} from 'model-bank/aiModel';

interface RequestParameterRow {
  name: string;
  rawValue: string;
  type: ModelRequestParameterType;
}

export const toRequestParameterRows = (config?: AiModelConfig): RequestParameterRow[] =>
  (
    config?.customRequestParameters ??
    (config?.openRouterProvider
      ? [
          {
            name: 'provider',
            type: 'json' as const,
            value: JSON.stringify(config.openRouterProvider, null, 2),
          },
        ]
      : [])
  ).map(({ name, type, value }) => ({
    name,
    rawValue: String(value),
    type,
  }));

export const parseRequestParameterRows = (rows: RequestParameterRow[]) => {
  const parsed = rows.map(({ name, rawValue, type }) => {
    let value: unknown = rawValue;
    if (type === 'number') value = rawValue.trim() ? Number(rawValue) : NaN;
    if (type === 'boolean')
      value = rawValue === 'true' ? true : rawValue === 'false' ? false : rawValue;
    return { name, type, value };
  });
  const result = ModelRequestParametersSchema.safeParse(parsed);
  if (!result.success) {
    const index = result.error.issues[0]?.path[0];
    throw new Error(
      typeof index === 'number' ? rows[index]?.name.trim() || `#${index + 1}` : '64 KiB',
    );
  }
  return result.data;
};

const EDITABLE_ABILITIES = [
  'functionCall',
  'vision',
  'reasoning',
  'search',
  'imageOutput',
  'video',
] as const;

/**
 * Pick only the fields rendered by the model config form.
 *
 * base-ui `form.getValues()` returns every initial value, not just the registered fields
 * like antd `getFieldsValue()` did. The initial values are the merged model list item, so
 * they carry columns such as `config: null` (rejected by `UpdateAiModelSchema`, leaving the
 * confirm button spinning forever) and builtin-only settings that must not be persisted.
 */
export const pickModelConfigFormValues = (
  values: FormValues,
  {
    parametersOnly,
    showDeployName,
    showRequestParameters,
  }: {
    parametersOnly?: boolean;
    showDeployName?: boolean;
    showRequestParameters?: boolean;
  } = {},
): UpdateAiModelParams => {
  const customRequestParameters = showRequestParameters
    ? parseRequestParameterRows((values.requestParameterRows ?? []) as RequestParameterRow[])
    : undefined;
  const parameterConfig = showRequestParameters
    ? { customRequestParameters, openRouterProvider: null }
    : {};
  if (parametersOnly) return { config: parameterConfig };

  const abilities = (values.abilities ?? {}) as Record<string, unknown>;
  const settings = (values.settings ?? {}) as Record<string, unknown>;
  const config = (values.config ?? {}) as Record<string, unknown>;

  return {
    abilities: Object.fromEntries(
      EDITABLE_ABILITIES.map((key) => [key, abilities[key] ?? undefined]),
    ) as UpdateAiModelParams['abilities'],
    config:
      showDeployName || showRequestParameters
        ? {
            ...(showDeployName && {
              deploymentName: (config.deploymentName as string | undefined) ?? undefined,
            }),
            ...parameterConfig,
          }
        : undefined,
    contextWindowTokens: values.contextWindowTokens as number | null | undefined,
    displayName: values.displayName as string | null | undefined,
    settings: {
      extendParams: (settings.extendParams ?? undefined) as NonNullable<
        UpdateAiModelParams['settings']
      >['extendParams'],
    },
    type: values.type as UpdateAiModelParams['type'],
  };
};
