import { afterEach, describe, expect, it, vi } from 'vitest';

import { getNeonUploadFunctionUrl, putNeonUpload } from './neonUpload';

const app = 'https://451287.xyz';
const storage = 'https://br-hidden-dew-ae8lcssj.storage.c-2.us-east-2.aws.neon.tech';
const key = '/lobehub-files/files/test.png';
const query =
  '?X-Amz-SignedHeaders=content-length%3Bhost&X-Amz-Signature=' + 'a'.repeat(64) + '&x-id=PutObject';
const direct = storage + key + query;
const relay = app + '/api/lobehub-neon-put' + key + query;

afterEach(() => vi.unstubAllGlobals());

describe('Neon attachment relay', () => {
  it('keeps the signed object path and query when routing a small upload over the function', () => {
    expect(getNeonUploadFunctionUrl(direct, app, 3)).toBe(relay);
    expect(getNeonUploadFunctionUrl(direct, app, 4 * 1024 * 1024 + 1)).toBe(direct);
    expect(getNeonUploadFunctionUrl(direct, 'https://example.com', 3)).toBe(direct);
    expect(getNeonUploadFunctionUrl(direct.replace('PutObject', 'UploadPart'), app, 3)).toContain(
      storage,
    );
  });

  it('sends the original body with a fresh set of headers from the server', async () => {
    const forward = vi.fn().mockResolvedValue(new Response(null, { headers: { ETag: '"abc"' } }));
    vi.stubGlobal('fetch', forward);
    const request = new Request(relay, {
      body: 'abc',
      headers: {
        Authorization: 'Bearer dummy',
        'Content-Length': '3',
        'Content-Type': 'image/png',
        Cookie: 'session=dummy',
        Origin: app,
        Referer: app + '/',
        'X-Forwarded-For': '192.0.2.1',
      },
      method: 'PUT',
    });

    const response = await putNeonUpload(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"abc"');
    const [url, options] = forward.mock.calls[0];
    expect(url.href).toBe(direct);
    expect(options.headers).toEqual({ 'Content-Length': '3', 'Content-Type': 'image/png' });
    expect(new TextDecoder().decode(options.body)).toBe('abc');
  });

  it('rejects unsigned requests, mismatched lengths, and oversized bodies before forwarding', async () => {
    const forward = vi.fn();
    vi.stubGlobal('fetch', forward);
    for (const [url, size, status] of [
      [relay.split('?')[0], '3', 403],
      [relay, '4', 400],
      [relay, '5000000', 413],
    ] as const) {
      const request = new Request(url, {
        body: 'abc',
        headers: { 'Content-Length': size },
        method: 'PUT',
      });
      expect((await putNeonUpload(request)).status).toBe(status);
    }
    expect(forward).not.toHaveBeenCalled();
  });
});
