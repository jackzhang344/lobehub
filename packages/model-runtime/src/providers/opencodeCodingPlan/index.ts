import type { ChatStreamPayload, ModelRequestParams } from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import urlJoin from 'url-join';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime/createRuntime';
import { resolveProviderRouteModels } from '../../core/RouterRuntime/providerModels';
import type { ChatMethodOptions } from '../../types';
import {
  isKimiNativeThinkingModel,
  isKimiReasoningEffortModel,
  parseKimiModelId,
  resolveKimiReasoningEffort,
} from '../moonshot/modelId';
import { resolveOpenCodeSessionId } from './session';

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
const MODELS_DEV_URL = 'https://models.dev/api.json';
const OPENCODE_GO_PROVIDER = 'opencode-go';
// Go serves Gemini from a dedicated Google-dialect endpoint (models.dev marks those
// models with provider.npm '@ai-sdk/google'), not the OpenAI-compatible one.
const GOOGLE_BASE_URL = 'https://opencode.ai/inference/go/google/v1beta';

// Fallback: models that need Anthropic SDK when models.dev is unavailable
const ANTHROPIC_MODEL_PREFIXES = ['minimax', 'qwen'];
// Fallback: models that need Google SDK when models.dev is unavailable
const GOOGLE_MODEL_PREFIXES = ['gemini'];

// Fallback: interleaved thinking models when models.dev is unavailable
const INTERLEAVED_FALLBACK_MODELS = new Set([
  'glm-5',
  'glm-5.1',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'mimo-v2.5-pro',
  'mimo-v2.5',
  'mimo-v2-omni',
  'mimo-v2-pro',
  'kimi-k2.5',
  'kimi-k2.6',
]);

interface ModelsDevModel {
  id: string;
  interleaved?: { field: string };
  provider?: { api?: string; npm?: string };
  reasoning?: boolean;
  reasoning_options?: Array<{ type?: string; values?: string[] }>;
}

interface ModelsCache {
  anthropicModels: string[];
  googleModels: string[];
  interleavedIds: Set<string>;
  modelsDev: Record<string, ModelsDevModel>;
  responsesIds: Set<string>;
}

let cachedModelsData: ModelsCache | null = null;

const fetchModelsDevData = async (): Promise<ModelsCache> => {
  if (cachedModelsData) return cachedModelsData;

  try {
    const res = await fetch(MODELS_DEV_URL);
    const data = await res.json();
    const models: Record<string, ModelsDevModel> = data[OPENCODE_GO_PROVIDER]?.models || {};

    const anthropicModels = Object.values(models)
      .filter((m) => m.provider?.npm === '@ai-sdk/anthropic')
      .map((m) => m.id);

    const googleModels = Object.values(models)
      .filter((m) => m.provider?.npm === '@ai-sdk/google')
      .map((m) => m.id);

    const interleavedIds = new Set(
      Object.values(models)
        .filter((m) => m.interleaved?.field)
        .map((m) => m.id),
    );

    const responsesIds = new Set(
      Object.values(models)
        .filter((m) => m.provider?.npm === '@ai-sdk/openai')
        .map((m) => m.id),
    );

    cachedModelsData = { anthropicModels, googleModels, interleavedIds, modelsDev: models, responsesIds };
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

// Anthropic SDK auto-appends /v1 to baseURL, so strip it if present
const stripV1 = (url: string) => url.replace(/\/v1\/?$/, '');

// The Google SDK appends the API version (/v1beta) itself, so strip it from the
// models.dev endpoint before handing it to the client as baseUrl.
const stripGoogleApiVersion = (url: string) => url.replace(/\/v1(?:beta)?\/?$/, '');

// Self-contained: falls back to static model-bank if models.dev is unreachable
const getAnthropicModels = async (): Promise<string[]> => {
  const { anthropicModels, modelsDev } = await fetchModelsDevData();
  if (Object.keys(modelsDev).length > 0) return anthropicModels;

  try {
    const { opencodecodingplan } = await import('model-bank');
    return opencodecodingplan
      .map((m) => m.id)
      .filter((id) => ANTHROPIC_MODEL_PREFIXES.some((p) => id.startsWith(p)));
  } catch {
    return [];
  }
};

// Self-contained: falls back to static model-bank if models.dev is unreachable
const getGoogleModels = async (): Promise<string[]> => {
  const { googleModels, modelsDev } = await fetchModelsDevData();
  if (Object.keys(modelsDev).length > 0) return googleModels;

  try {
    const { opencodecodingplan } = await import('model-bank');
    return opencodecodingplan
      .map((m) => m.id)
      .filter((id) => GOOGLE_MODEL_PREFIXES.some((p) => id.startsWith(p)));
  } catch {
    return [];
  }
};

// Prefer the Google endpoint published by models.dev; fall back to the documented
// constant. A user-configured proxy baseURL cannot be translated to the Google
// dialect path, so this route always targets the official Go Google endpoint.
const getGoogleBaseURL = async (): Promise<string> => {
  const { modelsDev } = await fetchModelsDevData();
  const googleModel = Object.values(modelsDev).find(
    (m) => m.provider?.npm === '@ai-sdk/google' && m.provider?.api,
  );
  return googleModel?.provider?.api || GOOGLE_BASE_URL;
};

// models.dev publishes the effort values each Go model accepts (reasoning_options).
// Prefer it so new variants stay in sync without a release-time code change.
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

// Strip unsupported params and re-emit effort/thinking for interleaved models.
// Kimi K2.5/K2.6 accept reasoning_effort; K3+ effort is variant-gated (see
// resolveGoKimiReasoningEffort). K2.7-code/K3 are native-thinking models: they
// reject thinking disabled, so that value is dropped for them.
const buildOpenAIPayload = (payload: ChatStreamPayload): ModelRequestParams => {
  const model = payload.model;
  const isKimi = isKimiReasoningEffortModel(model) || isKimiNativeThinkingModel(model);
  const interleaved =
    INTERLEAVED_FALLBACK_MODELS.has(model) ||
    !!cachedModelsData?.interleavedIds?.has(model) ||
    isKimi;

  if (!isKimi && !interleaved) return payload as any;

  const { reasoning_effort, thinking, ...restPayload } = payload;
  // K2.6 honors thinking disabled; K2.7-code/K3 always think and reject it.
  const thinkingExplicitlyDisabled =
    thinking?.type === 'disabled' && !isKimiNativeThinkingModel(model);
  const resolvedReasoningEffort =
    reasoning_effort && isKimiReasoningEffortModel(model)
      ? resolveGoKimiReasoningEffort(model, reasoning_effort)
      : reasoning_effort;

  return {
    ...restPayload,
    ...(!thinkingExplicitlyDisabled && resolvedReasoningEffort
      ? { reasoning_effort: resolvedReasoningEffort }
      : {}),
    ...(thinking?.type === 'enabled' || thinkingExplicitlyDisabled
      ? { thinking: { type: thinking.type } }
      : {}),
  } as any;
};

class LobeOpenAICompatibleAI {
  private client: any;
  private baseURL: string;
  private apiKey: string;

  constructor(options: any) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL || GO_BASE_URL;
    const { default: OpenAI } = require('openai');
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      defaultHeaders: options.defaultHeaders,
    });
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    const { reasoning_effort, thinking, ...restPayload } = payload;
    const handledPayload = buildOpenAIPayload(payload);
    const apiMode = responsesAPIModels.has(payload.model) ? 'responses' : 'chatCompletion';
    return this.client.chat.completions.create(handledPayload as any, {
      headers: options?.requestHeaders,
      signal: options?.signal,
    });
  }

  async models() {
    return this.client.models.list();
  }
}

/**
 * OpenCode Go — RouterRuntime with OpenAI-compatible / Anthropic / DeepSeek / Google routes.
 * Anthropic models (MiniMax, Qwen) use /v1/messages; Google models (Gemini) use the
 * dedicated Google-dialect endpoint; DeepSeek keeps its native reasoning payload
 * handling; everything else uses OpenAI-compatible format.
 * Model routing data sourced from models.dev, with static fallback.
 * @see https://opencode.ai/docs/zen
 */
export const LobeOpenCodeCodingPlanAI = createRouterRuntime({
  id: 'opencodecodingplan',
  models: async ({ client, options }) => {
    try {
      const modelList = await client.models.list();
      const apiModels = modelList.data.map((m) => ({
        contextWindowTokens: m.context_window ?? undefined,
        displayName: m.id,
        enabled: m.id === 'glm-5.1',
        id: m.id,
        type: 'chat' as const,
      }));
      const enriched = await enrichWithModelsDev(apiModels);
      return processMultiProviderModelList(enriched, 'opencodecodingplan');
    } catch {
      const { modelsDev } = await fetchModelsDevData();
      const ids = Object.keys(modelsDev);
      if (ids.length === 0) return [];
      const fallbackModels = ids.map((id) => ({
        displayName: id,
        enabled: id === 'glm-5.1',
        id,
        type: 'chat' as const,
      }));
      const enriched = await enrichWithModelsDev(fallbackModels);
      return processMultiProviderModelList(enriched, 'opencodecodingplan');
    }
  },
  routers: async (options, runtimeContext) => {
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
      // DeepSeek runtime owns the V4 reasoning contract and its history replay semantics.
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: { ...options, baseURL },
      },
      // Google SDK for models with provider.npm === '@ai-sdk/google' (e.g. gemini-4-argon).
      // The Google runtime reads defaultHeaders at client construction and requestHeaders
      // per call, so Go session identity reaches this route as well.
      {
        apiType: 'google',
        models: googleModels,
        options: {
          ...options,
          baseURL: googleBaseURL,
          defaultHeaders: {
            'User-Agent': 'lobehub',
            'x-opencode-client': 'lobehub',
            ...options.defaultHeaders,
          },
        },
      },
      // OpenAI-compatible fallback for everything else
      {
        apiType: 'openai',
        runtime: LobeOpenAICompatibleAI,
        options: { ...options, baseURL },
      },
    ];
  },
});
