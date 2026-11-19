// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getNeonImagePreview } from './neonImagePreview';

const app = 'https://451287.xyz';
const signedUrl =
  'https://br-hidden-dew-ae8lcssj.storage.c-2.us-east-2.aws.neon.tech/lobehub-files/files/image.png' +
  '?X-Amz-Signature=' + 'a'.repeat(64);

afterEach(() => vi.unstubAllGlobals());

describe('Neon historical image preview', () => {
  it('streams image bytes at the stable file URL without forwarding browser credentials', async () => {
    const pixels = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const storage = new Response(pixels, { headers: { ETag: '"stored-image"' } });
    const fetcher = vi.fn().mockResolvedValue(storage);
    vi.stubGlobal('fetch', fetcher);
    const request = new Request(app + '/f/file-id', {
      headers: {
        Authorization: 'Bearer dummy',
        Cookie: 'session=dummy',
        'X-Forwarded-For': '192.0.2.1',
      },
    });

    const result = await getNeonImagePreview({
      appOrigin: app,
      fileType: 'image/png',
      request,
      signedUrl,
    });

    expect(result?.status).toBe(200);
    expect(result?.headers.get('location')).toBeNull();
    expect(result?.headers.get('content-type')).toBe('image/png');
    expect(result?.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(pixels);
    const [target, options] = fetcher.mock.calls[0];
    expect(target.href).toBe(signedUrl);
    expect([...options.headers.entries()]).toEqual([]);
    expect(options.cache).toBe('no-store');
  });

  it('preserves partial-image reads and safe response metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        headers: { 'Content-Range': 'bytes 0-1/10', 'Accept-Ranges': 'bytes' },
        status: 206,
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await getNeonImagePreview({
      appOrigin: app,
      fileType: 'image/png',
      request: new Request(app + '/f/file-id', { headers: { Range: 'bytes=0-1' } }),
      signedUrl,
    });
    expect(result?.status).toBe(206);
    expect(result?.headers.get('content-range')).toBe('bytes 0-1/10');
    expect(fetcher.mock.calls[0][1].headers.get('range')).toBe('bytes=0-1');
  });

  it('keeps non-Neon files and other deployments on their existing delivery path', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const base = { appOrigin: app, fileType: 'image/png', request: new Request(app), signedUrl };
    expect(await getNeonImagePreview({ ...base, appOrigin: 'https://example.com' })).toBeUndefined();
    expect(
      await getNeonImagePreview({ ...base, signedUrl: 'https://example.com/image.png' }),
    ).toBeUndefined();
    expect(await getNeonImagePreview({ ...base, fileType: 'application/pdf' })).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not cache or disclose a storage error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('storage detail', { status: 403 })));
    const response = await getNeonImagePreview({
      appOrigin: app,
      fileType: 'image/png',
      request: new Request(app),
      signedUrl,
    });
    expect(response?.status).toBe(403);
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
    expect(await response?.text()).toBe('Image storage returned HTTP 403');
  });
});
