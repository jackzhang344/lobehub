const APP_ORIGIN = 'https://451287.xyz';
const NEON_ORIGIN = 'https://br-hidden-dew-ae8lcssj.storage.c-2.us-east-2.aws.neon.tech';

interface NeonImagePreviewParams {
  appOrigin: string;
  fileType?: string | null;
  request: Request;
  signedUrl: string;
}

/** Deliver stored chat images without sending the viewer to the storage host. */
export const getNeonImagePreview = async ({
  appOrigin,
  fileType,
  request,
  signedUrl,
}: NeonImagePreviewParams): Promise<Response | undefined> => {
  if (appOrigin !== APP_ORIGIN || !fileType?.startsWith('image/')) return undefined;

  const target = new URL(signedUrl);
  if (
    target.origin !== NEON_ORIGIN ||
    !target.pathname.startsWith('/lobehub-files/') ||
    !target.searchParams.has('X-Amz-Signature')
  ) {
    return undefined;
  }

  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) {
    headers.set('Range', range);
    const ifRange = request.headers.get('if-range');
    if (ifRange) headers.set('If-Range', ifRange);
  }

  const upstream = await fetch(target, {
    cache: 'no-store',
    headers,
    redirect: 'error',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
  });
  const responseHeaders = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Type': fileType,
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of ['accept-ranges', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  if (!upstream.ok) {
    await upstream.body?.cancel();
    console.warn('[neon-image-preview] storage rejected GET', { status: upstream.status });
    return new Response('Image storage returned HTTP ' + upstream.status, {
      headers: { 'Cache-Control': 'private, no-store' },
      status: upstream.status,
    });
  }

  // Keep the response streamed so large images do not need to be buffered.
  return new Response(upstream.body, { headers: responseHeaders, status: upstream.status });
};
