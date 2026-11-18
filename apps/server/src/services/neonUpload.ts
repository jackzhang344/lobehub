const APP_ORIGIN = 'https://451287.xyz';
const NEON_ORIGIN = 'https://br-hidden-dew-ae8lcssj.storage.c-2.us-east-2.aws.neon.tech';
const BUCKET_PREFIX = '/lobehub-files/';
const RELAY_PREFIX = '/api/lobehub-neon-put';
const MAX_RELAY_BYTES = 4 * 1024 * 1024;

const isSignedPut = (url: URL) =>
  url.pathname.startsWith(BUCKET_PREFIX) &&
  url.pathname.length > BUCKET_PREFIX.length &&
  url.searchParams.get('x-id') === 'PutObject' &&
  !url.searchParams.has('uploadId') &&
  url.searchParams.get('X-Amz-SignedHeaders') === 'content-length;host' &&
  /^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '');

export const getNeonUploadFunctionUrl = (
  signedUrl: string,
  appOrigin: string,
  size: number,
): string => {
  if (appOrigin !== APP_ORIGIN || size > MAX_RELAY_BYTES) return signedUrl;

  const url = new URL(signedUrl);
  if (url.origin !== NEON_ORIGIN || !isSignedPut(url)) return signedUrl;

  return APP_ORIGIN + RELAY_PREFIX + url.pathname + url.search;
};

const reply = (message: string, status: number) =>
  new Response(message, { headers: { 'Cache-Control': 'private, no-store' }, status });

export const putNeonUpload = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.origin !== APP_ORIGIN || !url.pathname.startsWith(RELAY_PREFIX + BUCKET_PREFIX)) {
    return reply('Upload endpoint not found', 404);
  }

  const target = new URL(NEON_ORIGIN);
  target.pathname = url.pathname.slice(RELAY_PREFIX.length);
  target.search = url.search;

  // The existing Neon signature authorizes exactly this key and body length.
  if (target.origin !== NEON_ORIGIN || !isSignedPut(target)) {
    return reply('Invalid upload signature', 403);
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength === null || !/^\d+$/.test(contentLength)) {
    return reply('Upload length required', 411);
  }
  const size = Number(contentLength);
  if (size > MAX_RELAY_BYTES) return reply('Upload exceeds 4 MiB', 413);

  try {
    const body = await request.arrayBuffer();
    if (body.byteLength !== size) return reply('Upload length mismatch', 400);

    // Start a new request inside the configured function region. Forward only
    // the file and its content type, without the browser's cookies or IP headers.
    const result = await fetch(target, {
      body,
      headers: {
        'Content-Length': String(size),
        'Content-Type': request.headers.get('content-type') || 'application/octet-stream',
      },
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    });

    const etag = result.headers.get('etag');
    await result.body?.cancel();
    if (!result.ok) {
      console.warn('[neon-upload] storage rejected PUT', { status: result.status });
      return reply('Storage rejected upload (HTTP ' + result.status + ')', result.status);
    }

    return new Response(null, {
      headers: { 'Cache-Control': 'private, no-store', ...(etag ? { ETag: etag } : {}) },
      status: result.status,
    });
  } catch (error) {
    console.warn('[neon-upload] storage request failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return reply('Storage connection failed', 502);
  }
};
