import { describe, expect, it, vi } from 'vitest';

import { getNeonUploadRelayUrl } from './upload';

vi.mock('@/libs/trpc/client', () => ({ lambdaClient: {} }));

const site = 'https://451287.xyz';
const storage = 'https://br-hidden-dew-ae8lcssj.storage.c-2.us-east-2.aws.neon.tech';
const objectPath = '/lobehub-files/files/123/probe.pdf';
const signedQuery = '?X-Amz-SignedHeaders=content-length%3Bhost&X-Amz-Signature=' + 'a'.repeat(64);
const url = storage + objectPath + signedQuery;

describe('Neon upload relay', () => {
  it('keeps the signed path and query unchanged when relaying to the site', () => {
    expect(getNeonUploadRelayUrl(url, site)).toBe(
      '/api/lobehub-neon-upload' + objectPath + signedQuery,
    );
  });

  it('keeps other sites and storage hosts out of the relay', () => {
    expect(getNeonUploadRelayUrl(url, 'https://localhost:3010')).toBeUndefined();
    expect(
      getNeonUploadRelayUrl('https://other.example' + objectPath + signedQuery, site),
    ).toBeUndefined();
  });

  it('rejects other buckets, unsigned URLs, and URLs that have already been relayed', () => {
    expect(
      getNeonUploadRelayUrl(storage + '/another-bucket/files/probe.pdf' + signedQuery, site),
    ).toBeUndefined();
    expect(getNeonUploadRelayUrl(storage + objectPath, site)).toBeUndefined();
    expect(
      getNeonUploadRelayUrl('/api/lobehub-neon-upload' + objectPath + signedQuery, site),
    ).toBeUndefined();
  });
});
