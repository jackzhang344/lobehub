import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { pickNonEmptyString } from '../../utils/object';
import {
  isKimiNativeThinkingModel,
  isKimiReasoningEffortModel,
  isKimiReasoningModel,
  parseKimiModelId,
  resolveKimiReasoningEffort,
} from '../moonshot/modelId';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';
import { inlineOpenCodeHistoryImages } from './historyImages';

// ============================================================================
// Constants
// ============================================================================

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
const MODELS_DEV_URL = 'https://models.dev/api.json';
// Go serves Gemini from a dedicated Google-dialect endpoint (models.dev marks
// those models with provider.npm '@ai-sdk/google'), not the OpenAI-compatible one.
const GOOGLE_BASE_URL = 'https://opencode.ai/inference/go/google/v1beta';

// ============================================================================
// Models.dev Types & Cache
// ============================================================================

interface ModelsDevModel {
  [key: string]: any;
  attachment?: boolean;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  family?: string;
  id: string;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  name?: string;
  provider?: { api?: string; npm?: string };
  reasoning?: boolean;
  reasoning_options?: Array<{ type?: string; values?: string[] }>;
  release_date?: string;
  structured_output?: boolean;
  tool_call?: boolean;
}

interface ModelsDevData {
  [provider: string]: {
    models?: Record<string, ModelsDevModel>;
    npm?: string;
  };
}

interface ModelsCache {
  anthropicModels: string[];
  /**
   * Model IDs whose `provider.npm` is the Google SDK. They are served from Go's
   * dedicated Google-dialect endpoint and must not use the OpenAI-compatible route.
   */
  googleModels: string[];
  /**
   * Model IDs whose `interleaved.field` is set in models.dev. These need
   * special reasoning_content handling in the OpenAI-compatible payload.
   * Populated by `fetchModelsDevData` so it stays in sync with models.dev.
   */
  interleavedIds: Set<string>;
  modelsDev: Record<string, ModelsDevModel>;
  responsesIds: Set<string>;
}

// Fallback: models that need Anthropic SDK (used when models.dev is unavailable)
const ANTHROPIC_MODEL_PREFIXES = ['minimax', 'qwen'];

// Fallback: models that need Google SDK (used when models.dev is unavailable)
const GOOGLE_MODEL_PREFIXES = ['gemini'];
const FALLBACK_GOOGLE_MODELS = ['gemini-4-argon'];

// Fallback: models with interleaved reasoning_content (used when models.dev
// is unreachable). Mirrors the last-known state of models.dev.
const FALLBACK_INTERLEAVED_IDS: ReadonlySet<string> = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'glm-5',
  'glm-5.1',
  'kimi-k2.5',
  'kimi-k2.6',
  'mimo-v2-omni',
  'mimo-v2-pro',
  'mimo-v2.5',
  'mimo-v2.5-pro',
]);

// Fallback: models that require OpenAI's Responses API when models.dev is
// unreachable. Mirrors OpenCode Go's documented endpoint matrix.
const FALLBACK_RESPONSES_IDS: ReadonlySet<string> = new Set([
  'muse-spark-1.2-contributor',
  'muse-spark-1.3-contributor',
]);

let cachedModelsData: ModelsCache | null = null;

// ============================================================================
// Models.dev Fetcher
// ============================================================================

/**
 * Fetch models.dev data and derive all per-provider fields from it:
 *   - `anthropicModels`  (models whose `provider.npm` is the Anthropic SDK)
 *   - `googleModels`     (models whose `provider.npm` is the Google SDK)
 *   - `responsesIds`     (models whose `provider.npm` is the OpenAI SDK)
 *   - `interleavedIds`   (models with `interleaved.field` set, needing
 *                         special reasoning_content handling)
 *   - `modelsDev`        (raw model map for enrichment)
 *
 * The result is cached for the process lifetime, so a single successful
 * fetch keeps every derived field in sync with models.dev.
 */
const fetchModelsDevData = async (): Promise<ModelsCache> => {
  if (cachedModelsData) return cachedModelsData;

  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: ModelsDevData = await res.json();
    const models = data?.['opencode-go']?.models;
    if (!models || typeof models !== 'object') {
      throw new Error('opencode-go provider not found in models.dev');
    }

    const anthropicModels = Object.values(models)
      .filter((m) => m.provider?.npm === '@ai-sdk/anthropic')
      .map((m) => m.id);
    const googleModels = Object.values(models)
      .filter((m) => m.provider?.npm === '@ai-sdk/google')
      .map((m) => m.id);
    const responsesIds = new Set(
      Object.values(models)
        .filter((m) => m.provider?.npm === '@ai-sdk/openai')
        .map((m) => m.id),
    );

    const interleavedIds = new Set<string>();
    for (const m of Object.values(models)) {
      if (m?.interleaved?.field) interleavedIds.add(m.id);
    }

    cachedModelsData = {
      anthropicModels,
      googleModels,
      interleavedIds,
      modelsDev: models,
      responsesIds,
    };
    return cachedModelsData;
  } catch {
    cachedModelsData = {
      anthropicModels: [],
      googleModels: [],
      interleavedIds: new Set(),
      modelsDev: {},
      responsesIds: new Set(),
    };
    return cachedModelsData;
  }
};

/**
 * Sync accessor for the interleaved model set. Returns the cached value
 * populated by `fetchModelsDevData`; falls back to a hardcoded snapshot of
 * models.dev's last-known state when the cache hasn't been populated yet
 * (e.g. the very first chat request before any models.dev fetch has run).
 */
const getInterleavedModelIds = (): ReadonlySet<string> => {
  if (cachedModelsData && cachedModelsData.interleavedIds.size > 0) {
    return cachedModelsData.interleavedIds;
  }
  return FALLBACK_INTERLEAVED_IDS;
};

const getResponsesModelIds = (): ReadonlySet<string> => {
  if (cachedModelsData && cachedModelsData.responsesIds.size > 0) {
    return cachedModelsData.responsesIds;
  }
  return FALLBACK_RESPONSES_IDS;
};

/**
 * Get anthropic models with self-contained fallback chain:
 *   1. models.dev (authoritative `provider.npm` field)
 *   2. static model-bank prefix match (used when models.dev is unreachable)
 *
 * Self-contained: does not depend on a runtime `client` object, so it's safe
 * to call from `routers` (which receives `ClientOptions` only and has no
 * `client` property during normal chat routing).
 */
const getAnthropicModels = async (): Promise<string[]> => {
  const { anthropicModels, modelsDev } = await fetchModelsDevData();

  if (Object.keys(modelsDev).length > 0) {
    return anthropicModels;
  }

  // Fallback: prefix-match the static model-bank list. Equivalent to the
  // pre-refactor hard-coded behavior when models.dev is unreachable.
  try {
    const { opencodecodingplan } = await import('model-bank');
    return opencodecodingplan
      .map((m) => m.id)
      .filter((id) => ANTHROPIC_MODEL_PREFIXES.some((p) => id.startsWith(p)));
  } catch {
    return [];
  }
};

/**
 * Get Google-SDK models with the same self-contained fallback chain as
 * `getAnthropicModels` (models.dev first, static model-bank prefix second).
 */
const getGoogleModels = async (): Promise<string[]> => {
  const { googleModels, modelsDev } = await fetchModelsDevData();

  if (Object.keys(modelsDev).length > 0) {
    return googleModels;
  }

  try {
    const { opencodecodingplan } = await import('model-bank');
    const staticGoogleModels = opencodecodingplan
      .map((m) => m.id)
      .filter((id) => GOOGLE_MODEL_PREFIXES.some((p) => id.startsWith(p)));
    return [...new Set([...FALLBACK_GOOGLE_MODELS, ...staticGoogleModels])];
  } catch {
    return FALLBACK_GOOGLE_MODELS;
  }
};

/**
 * Google-dialect endpoint for Go's Gemini models. Prefer the URL published by
 * models.dev (`provider.api`), falling back to the documented constant. A
 * user-configured proxy baseURL cannot be translated to this dialect path, so
 * the route always targets the official Go Google endpoint.
 */
const getGoogleBaseURL = async (): Promise<string> => {
  const { modelsDev } = await fetchModelsDevData();
  const googleModel = Object.values(modelsDev).find(
    (m) => m.provider?.npm === '@ai-sdk/google' && m.provider?.api,
  );
  return googleModel?.provider?.api || GOOGLE_BASE_URL;
};

// ============================================================================
// Models.dev → Model Card Enrichment
// ============================================================================

/**
 * Map a models.dev model entry to the flat fields understood by
 * `processModelCard`. Fields not provided by models.dev (description,
 * organization, settings, etc.) are filled in from the static model-bank
 * entry via the knownModel fallback in processModelCard.
 *
 * Pricing is passed in the flat `input` / `output` / `cachedInput` /
 * `writeCacheInput` shape; processModelCard's `formatPricing` converts it
 * into the new `units` array.
 */
const enrichWithModelsDev = (
  id: string,
  dev?: ModelsDevModel,
): { id: string; [key: string]: any } => {
  if (!dev) return { id };

  const inputModalities = dev.modalities?.input ?? [];
  const cost = dev.cost;
  const limit = dev.limit;

  return {
    id,
    displayName: dev.name,
    contextWindowTokens: limit?.context,
    maxOutput: limit?.output,
    releasedAt: dev.release_date,
    functionCall: dev.tool_call || undefined,
    reasoning: dev.reasoning || undefined,
    vision: inputModalities.includes('image') || undefined,
    structuredOutput: dev.structured_output || undefined,
    pricing: cost
      ? {
          input: cost.input,
          output: cost.output,
          cachedInput: cost.cache_read,
          writeCacheInput: cost.cache_write,
        }
      : undefined,
  };
};

// ============================================================================
// Reasoning Content Helpers
// ============================================================================

// Kimi dot-versioned k2 models (k2.5+) and later generations (k3+) expose
// reasoning on the OpenAI-compatible route
const isKimiThinkingToggleModel = isKimiReasoningModel;

// Models in `interleavedIds` need:
//   1. reason → reasoning_content conversion
//   2. reasoning_content forced on all assistant messages
// The set is populated from models.dev by `fetchModelsDevData`; the fallback
// is used when models.dev hasn't been fetched yet.
// Ref: https://models.dev/api.json → opencode-go.interleaved
const isInterleavedModel = (model: string) => {
  for (const id of getInterleavedModelIds()) {
    if (model?.includes(id)) return true;
  }
  return false;
};

const hasValidReasoning = (reasoning: any) => typeof reasoning?.content === 'string';

const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;

// ============================================================================
// JSON Schema Sanitizer
// ============================================================================

/**
 * Recursively remove `null` values from `enum` arrays in a JSON Schema.
 * The opencode-go backend rejects nullable enums produced by Zod `.nullable()` / `.nullish()`.
 */
export const sanitizeJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);

  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    // Filter null from enum arrays
    if (key === 'enum' && Array.isArray(value)) {
      const filtered = value.filter((v: any) => v !== null);
      if (filtered.length > 0) result[key] = filtered;
      continue;
    }

    // type: ['string', 'null'] → type: 'string'
    if (key === 'type' && Array.isArray(value) && value.includes('null') && value.length >= 2) {
      const nonNullTypes = value.filter((v: any) => v !== 'null' && v !== null);
      if (nonNullTypes.length === 1) result.type = nonNullTypes[0];
      else if (nonNullTypes.length > 1) result.type = nonNullTypes;
      continue;
    }

    // Recurse into nested structures
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      const nested: any = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        nested[k] = sanitizeJsonSchema(v);
      }
      result[key] = nested;
    } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(sanitizeJsonSchema);
    } else if (
      [
        'items',
        'additionalProperties',
        'not',
        'contains',
        'if',
        'then',
        'else',
        'unevaluatedItems',
        'unevaluatedProperties',
      ].includes(key)
    ) {
      result[key] = sanitizeJsonSchema(value);
    } else {
      result[key] = sanitizeJsonSchema(value);
    }
  }
  return result;
};

// ============================================================================
// Payload Builder
// ============================================================================

// models.dev publishes the effort values each Go model accepts
// (`reasoning_options`). Prefer it so new variants stay in sync without a
// release-time code change.
const getModelsDevEffortValues = (model: string): string[] | undefined => {
  const options = cachedModelsData?.modelsDev?.[model]?.reasoning_options;
  if (!Array.isArray(options)) return undefined;

  const values = options.find((option) => option?.type === 'effort')?.values;
  return Array.isArray(values) ? values : undefined;
};

/**
 * OpenCode Go gates Kimi K3+ effort per variant: kimi-k3 accepts only 'max',
 * while k3.1+ accepts low/high/max. Drop anything else instead of sending a
 * value the API rejects.
 */
const resolveGoKimiReasoningEffort = (model: string, effort: string): string | undefined => {
  const allowed = getModelsDevEffortValues(model);
  if (allowed) return allowed.includes(effort) ? effort : undefined;

  const parsed = parseKimiModelId(model);
  if (parsed?.majorVersion === 3 && parsed.minorVersion === undefined) {
    return effort === 'max' ? 'max' : undefined;
  }

  return resolveKimiReasoningEffort(effort);
};

/**
 * Select Responses-only models and build OpenAI-compatible payloads with
 * reasoning_content handling for interleaved and Kimi K2.x models.
 */
const buildOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const model = payload.model;
  if (getResponsesModelIds().has(model)) {
    return { ...payload, apiMode: 'responses' } as OpenAI.ChatCompletionCreateParamsStreaming;
  }

  const isKimi = isKimiThinkingToggleModel(model);
  const interleaved = isInterleavedModel(model);

  if (!isKimi && !interleaved) return payload as any;

  // Native-thinking Kimi models (k2.7-code, k3+) cannot turn reasoning off, so a
  // saved disabled-thinking setting must be ignored: they still require
  // reasoning_content round-trip and reject a `thinking: disabled` payload.
  const nativeThinking = isKimiNativeThinkingModel(model);
  const thinkingExplicitlyDisabled =
    !nativeThinking && (payload as any).thinking?.type === 'disabled';
  const shouldForceReasoning = (interleaved || isKimi) && !thinkingExplicitlyDisabled;

  const messages = payload.messages.map((message: any) => {
    const { reasoning, ...rest } = message;
    const normalized = isKimi && isEmptyContent(message.content) ? { ...rest, content: ' ' } : rest;

    const reasoningContent =
      typeof normalized.reasoning_content === 'string'
        ? normalized.reasoning_content
        : hasValidReasoning(reasoning)
          ? reasoning.content
          : undefined;

    if (message.role === 'assistant' && shouldForceReasoning) {
      return { ...normalized, reasoning_content: reasoningContent ?? ' ' };
    }

    if (reasoningContent !== undefined) {
      return { ...normalized, reasoning_content: reasoningContent };
    }

    return normalized;
  });

  const { reasoning_effort, thinking, ...restPayload } = payload;

  // Kimi K3+ effort is variant-gated on Go; other models keep full passthrough.
  const resolvedReasoningEffort =
    reasoning_effort && isKimiReasoningEffortModel(model)
      ? resolveGoKimiReasoningEffort(model, reasoning_effort)
      : reasoning_effort;

  // Sanitize response_format for Kimi models
  const response_format =
    isKimi &&
    restPayload.response_format &&
    'json_schema' in restPayload.response_format &&
    restPayload.response_format.json_schema?.schema
      ? {
          ...restPayload.response_format,
          json_schema: {
            ...restPayload.response_format.json_schema,
            schema: sanitizeJsonSchema(restPayload.response_format.json_schema.schema),
          },
        }
      : restPayload.response_format;

  // Sanitize tool parameters for Kimi models
  const tools =
    isKimi && restPayload.tools
      ? restPayload.tools.map((tool: any) => ({
          ...tool,
          function: {
            ...tool.function,
            parameters: tool.function?.parameters
              ? sanitizeJsonSchema(tool.function.parameters)
              : tool.function?.parameters,
          },
        }))
      : restPayload.tools;

  return {
    ...restPayload,
    messages,
    response_format,
    tools,
    // Kimi K3+ effort is variant-gated (kimi-k3: 'max' only; k3.1+: low/high/max) —
    // drop anything else instead of sending a value the API rejects
    ...(!thinkingExplicitlyDisabled && resolvedReasoningEffort
      ? { reasoning_effort: resolvedReasoningEffort }
      : {}),
    // K3+ models configure reasoning via top-level reasoning_effort only and
    // reject the K2.x-only `thinking` param; native-thinking models never get
    // `disabled` re-emitted (the toggle does not exist for them).
    ...(!isKimiReasoningEffortModel(model) &&
    (thinking?.type === 'enabled' || (thinking?.type === 'disabled' && !nativeThinking))
      ? { thinking: { type: thinking.type } }
      : {}),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

// ============================================================================
// Runtime Instances
// ============================================================================

// OpenAI-compatible runtime for non-Anthropic models
const LobeOpenCodeCodingPlanOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: GO_BASE_URL,
  chatCompletion: { handlePayload: buildOpenAIPayload },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  generateObject: {
    get useResponseModels() {
      return [...getResponsesModelIds()];
    },
  },
});

// Anthropic SDK auto-appends /v1/messages to baseURL, so strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

// The Google SDK appends the API version (/v1beta) itself, so strip it from the
// models.dev endpoint before handing it to the client as baseUrl.
const stripGoogleApiVersion = (url: string) => url.replace(/\/v1(?:beta)?$/, '');

// ============================================================================
// Provider Export
// ============================================================================

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeCodingPlan,
  models: async ({ client }) => {
    // Always pull models.dev for enrichment (cached after first call).
    const { modelsDev } = await fetchModelsDevData();

    try {
      // 1. Try API first (real-time available models), enriched with models.dev.
      const modelsPage = await (client as any).models.list();
      const apiModels = modelsPage.data || [];
      return processMultiProviderModelList(
        apiModels.map((m: { id: string }) => enrichWithModelsDev(m.id, modelsDev[m.id])),
        'opencodecodingplan',
      );
    } catch {
      // 2. Fallback to models.dev (if we got data) enriched with itself.
      const modelIds = Object.keys(modelsDev);
      if (modelIds.length > 0) {
        return processMultiProviderModelList(
          modelIds.map((id) => enrichWithModelsDev(id, modelsDev[id])),
          'opencodecodingplan',
        );
      }

      // 3. Final fallback: static model bank.
      const { opencodecodingplan } = await import('model-bank');
      return processMultiProviderModelList(
        opencodecodingplan.map((m) => ({ id: m.id })),
        'opencodecodingplan',
      );
    }
  },
  routers: async (options, runtimeContext?: { model?: string }) => {
    const baseURL = options.baseURL || GO_BASE_URL;

    const [anthropicModels, googleModels] = await Promise.all([
      getAnthropicModels(),
      getGoogleModels(),
    ]);
    const googleBaseURL = stripGoogleApiVersion(await getGoogleBaseURL());

    return [
      // Anthropic SDK for models with provider.npm === '@ai-sdk/anthropic'
      {
        apiType: 'anthropic',
        models: anthropicModels,
        options: { ...options, baseURL: stripV1(baseURL) },
      },
      // DeepSeek models via the deepseek runtime (OpenAI-compatible endpoint)
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: { ...options, baseURL, sdkType: 'openai' },
      },
      // Google SDK for models with provider.npm === '@ai-sdk/google' (e.g.
      // gemini-4-argon), served from Go's dedicated Google-dialect endpoint.
      // The Google runtime reads defaultHeaders at client construction and
      // requestHeaders per call, so Go session identity reaches this route too.
      {
        apiType: 'google',
        models: googleModels,
        options: {
          ...options,
          baseURL: googleBaseURL,
          defaultHeaders: {
            'User-Agent': 'lobehub',
            'x-opencode-client': 'lobehub',
            ...(options as any).defaultHeaders,
          },
        },
      },
      // OpenAI-compatible fallback for all other models
      {
        apiType: 'openai',
        runtime: LobeOpenCodeCodingPlanOpenAI as any,
        options: { ...options, baseURL },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export class LobeOpenCodeCodingPlanAI extends createRouterRuntime(params) {
  private getSessionHeaders(metadata?: Record<string, unknown>) {
    return {
      'User-Agent': 'lobehub',
      'x-opencode-client': 'lobehub',
      // Callers preserve topic identity or reuse a task ID across related calls.
      // Only requests without either identity receive a standalone session.
      'x-opencode-session':
        pickNonEmptyString(metadata?.topicId) ??
        pickNonEmptyString(metadata?.taskId) ??
        crypto.randomUUID(),
    };
  }

  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    const request = await inlineOpenCodeHistoryImages(payload, process.env.APP_URL, options?.signal);
    return super.chat(request, {
      ...options,
      requestHeaders: {
        ...this.getSessionHeaders(options?.metadata),
        ...options?.requestHeaders,
      },
    });
  }

  override async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    return super.generateObject(payload, {
      ...options,
      headers: {
        ...this.getSessionHeaders(options?.metadata),
        ...options?.headers,
      },
    });
  }
}
