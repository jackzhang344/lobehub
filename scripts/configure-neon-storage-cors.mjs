import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

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

  const preflight = await fetch(
    `${endpoint.origin}/${encodeURIComponent(bucket)}/__lobehub_cors_check__`,
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    },
  );

  if (!preflight.ok || preflight.headers.get('access-control-allow-origin') !== origin) {
    throw new Error(`CorsPreflightFailed(${preflight.status})`);
  }

  console.log('LobeHub storage CORS rule verified and browser upload preflight passed.');
} catch (error) {
  const safeMessage = /^(MissingStorageConfiguration|InvalidNeonStorageEndpoint|CorsRuleReadbackFailed|CorsPreflightFailed\(\d+\))$/;
  const kind = safeMessage.test(error.message) ? error.message : error.name;
  console.error('LobeHub storage CORS setup failed:', kind, error.$metadata?.httpStatusCode ?? '');
  process.exitCode = 1;
}
