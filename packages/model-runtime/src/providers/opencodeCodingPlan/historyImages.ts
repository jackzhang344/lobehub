import type { ChatStreamPayload } from '../../types';
import { inferImageMimeTypeFromBytes } from '../../utils/imageMimeType';
import { readBlobWithLimit } from '../../utils/readBlobWithLimit';

const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DOWNLOADS = 16;
const DOWNLOAD_TIMEOUT_MS = 12_000;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const FLASH_MODEL = /(?:^|\/)deepseek-v4\.1-flash(?:-1017)?(?:-free)?$/i;
const FILE_PATH = /^\/f\/file_[\w-]+$/;

export const inlineOpenCodeHistoryImages = async (
  payload: ChatStreamPayload,
  appUrl: string | undefined,
  requestSignal?: AbortSignal,
): Promise<ChatStreamPayload> => {
  if (!FLASH_MODEL.test(payload.model) || !appUrl || !URL.canParse(appUrl)) return payload;
  const app = new URL(appUrl);
  if (app.protocol !== 'https:') return payload;

  const urls = new Set<string>();
  for (const { content } of payload.messages) {
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type !== 'image_url' || !URL.canParse(part.image_url.url)) continue;
      const url = new URL(part.image_url.url);
      if (url.origin === app.origin && FILE_PATH.test(url.pathname) && !url.search) {
        urls.add(part.image_url.url);
      }
    }
  }
  if (urls.size === 0) return payload;

  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  const inlined = new Map<string, string>();
  let remainingBytes = MAX_INLINE_BYTES;
  for (const url of [...urls].slice(0, MAX_IMAGE_DOWNLOADS)) {
    if (signal.aborted || remainingBytes <= 0) break;
    try {
      // Fetch the same public file URL as the provider, without forwarded credentials.
      const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal });
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }

      const blob = await readBlobWithLimit(response, remainingBytes);
      const bytes = await blob.arrayBuffer();
      remainingBytes -= bytes.byteLength;
      const mimeType = await inferImageMimeTypeFromBytes(bytes);
      if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) continue;
      inlined.set(url, `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`);
    } catch {
      // If the file cannot be inlined, preserve the original URL and provider behavior.
      continue;
    }
  }
  requestSignal?.throwIfAborted();
  if (inlined.size === 0) return payload;

  return {
    ...payload,
    messages: payload.messages.map((message) =>
      Array.isArray(message.content)
        ? {
            ...message,
            content: message.content.map((part) => {
              const url = part.type === 'image_url' ? inlined.get(part.image_url.url) : undefined;
              return part.type === 'image_url' && url
                ? { ...part, image_url: { ...part.image_url, url } }
                : part;
            }),
          }
        : message,
    ),
  };
};
