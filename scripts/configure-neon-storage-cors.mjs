import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

if (process.env.VERCEL_ENV === 'preview') process.exit(0);

const bucket = process.env.S3_BUCKET;
const endpointValue = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const origin = 'https://lobehub-rho-drab.vercel.app';
const methods = ['GET', 'PUT', 'HEAD', 'POST', 'DELETE'];

function hasLobeHubRule(rules) {
  return rules.some(
    (rule) =>
      rule.AllowedOrigins?.includes(origin) &&
      rule.AllowedHeaders?.includes('*') &&
      methods.every((method) => rule.AllowedMethods?.includes(method)),
  );
}

try {
  if (!bucket || !endpointValue || !region || !accessKeyId || !secretAccessKey) {
    throw new Error('MissingStorageConfiguration');
  }

  const endpoint = new URL(endpointValue);
  if (
    endpoint.protocol !== 'https:' ||
    !endpoint.hostname.endsWith('.neon.tech') ||
    !endpoint.hostname.includes('.storage.') ||
    endpoint.pathname !== '/' ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error('InvalidNeonStorageEndpoint');
  }

  const client = new S3Client({
    endpoint: endpoint.origin,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  const readRules = async () => {
    try {
      const result = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
      return result.CORSRules ?? [];
    } catch (error) {
      if (error.name === 'NoSuchCORSConfiguration') return [];
      throw error;
    }
  };

  const currentRules = await readRules();
  if (!hasLobeHubRule(currentRules)) {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            ...currentRules,
            { AllowedOrigins: [origin], AllowedHeaders: ['*'], AllowedMethods: methods },
          ],
        },
      }),
    );

    if (!hasLobeHubRule(await readRules())) {
      throw new Error('CorsRuleReadbackFailed');
    }
  }

  const key = `__lobehub_cors_check__/${randomUUID()}.txt`;
  const object = { Bucket: bucket, Key: key };
  const testBody = 'LobeHub storage check';
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ ...object, ContentType: 'text/plain' }),
    { expiresIn: 60 },
  );
  const downloadUrl = await getSignedUrl(client, new GetObjectCommand(object), { expiresIn: 60 });
  const allowsOrigin = (response) => {
    const value = response.headers.get('access-control-allow-origin');
    return value === origin || value === '*';
  };

  const preflight = await fetch(uploadUrl, {
    method: 'OPTIONS',
    redirect: 'error',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const allowedMethods = preflight.headers.get('access-control-allow-methods')?.split(/,\s*/) ?? [];
  const allowedHeaders = preflight.headers.get('access-control-allow-headers')?.split(/,\s*/) ?? [];
  if (
    !preflight.ok ||
    !allowsOrigin(preflight) ||
    !allowedMethods.includes('PUT') ||
    !(allowedHeaders.includes('*') || allowedHeaders.includes('content-type'))
  ) {
    throw new Error(`CorsPreflightFailed(${preflight.status})`);
  }

  try {
    const uploaded = await fetch(uploadUrl, {
      method: 'PUT',
      body: testBody,
      credentials: 'omit',
      redirect: 'error',
      headers: { Origin: origin, 'Content-Type': 'text/plain' },
    });
    if (!uploaded.ok || !allowsOrigin(uploaded)) {
      throw new Error(`CorsUploadFailed(${uploaded.status})`);
    }

    const downloaded = await fetch(downloadUrl, {
      credentials: 'omit',
      redirect: 'error',
      headers: { Origin: origin },
    });
    if (!downloaded.ok || !allowsOrigin(downloaded) || (await downloaded.text()) !== testBody) {
      throw new Error(`CorsDownloadFailed(${downloaded.status})`);
    }

    const anonymous = await fetch(downloadUrl.split('?')[0], { redirect: 'error' });
    if (![401, 403, 404].includes(anonymous.status)) {
      throw new Error(`UnsignedReadNotRejected(${anonymous.status})`);
    }
  } finally {
    await client.send(new DeleteObjectCommand(object));
  }

  console.log('LobeHub storage CORS verified: signed upload and download passed; unsigned read was rejected.');
  if (preflight.headers.get('access-control-allow-origin') === '*') {
    console.log('Neon returned a wildcard preflight origin despite the saved LobeHub origin rule.');
  }
} catch (error) {
  const safeMessage = /^(MissingStorageConfiguration|InvalidNeonStorageEndpoint|CorsRuleReadbackFailed|(?:CorsPreflightFailed|CorsUploadFailed|CorsDownloadFailed|UnsignedReadNotRejected)\(\d+\))$/;
  const kind = safeMessage.test(error.message) ? error.message : error.name;
  console.error('LobeHub storage CORS setup failed:', kind, error.$metadata?.httpStatusCode ?? '');
  process.exitCode = 1;
}
