import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { FileService } from '@/server/services/file';
import { getNeonImagePreview } from '@/server/services/neonImagePreview';

export const runtime = 'nodejs';
export const preferredRegion = 'iad1';
export const maxDuration = 60;

const log = debug('lobe-file:proxy');

type Params = Promise<{ id: string }>;

/**
 * File proxy service
 * GET /f/:id
 *
 * Features:
 * - Query database to get file record (without userId filter for public access)
 * - Generate a temporary S3 presigned preview URL
 * - Stream Neon image previews through this server; redirect other file requests
 *
 * NOTE: This endpoint is intentionally unauthenticated. The proxy URL is
 * embedded in bare `<img>` tags, download links, and links shared to AI — none
 * of which can attach auth headers/cookies. Adding `checkAuth` here would break
 * every previously-shared `/f/:id` link, so access stays public by id.
 */
export const GET = async (req: Request, segmentData: { params: Params }) => {
  try {
    const params = await segmentData.params;
    const { id } = params;

    log('File proxy request: %s', id);

    // Get database connection
    const db = await getServerDB();

    // Query file record without userId filter (public access)
    const file = await FileModel.getFileById(db, id);

    if (!file) {
      log('File not found: %s', id);
      return new Response('File not found', {
        headers: { 'Cache-Control': 'private, no-store' },
        status: 404,
      });
    }

    // Create file service with file owner's userId
    const fileService = new FileService(db, file.userId);

    const isDownload = new URL(req.url).searchParams.get('download') === '1';
    const redirectUrl = isDownload
      ? await fileService.createDownloadUrl(file.url, file.name)
      : await fileService.createCachedPreSignedUrlForPreview(file.url);
    log('Web S3 presigned URL generated (%s)', isDownload ? 'download' : 'preview');

    if (!isDownload) {
      const preview = await getNeonImagePreview({
        appOrigin: appEnv.APP_URL,
        fileType: file.fileType,
        request: req,
        signedUrl: redirectUrl,
      });
      if (preview) return preview;
    }

    // Redirects contain temporary signatures and must not be cached by clients.
    return new Response(null, {
      headers: { 'Cache-Control': 'private, no-store', Location: redirectUrl },
      status: 302,
    });
  } catch (error) {
    console.error('File proxy error:', error);
    return new Response('Internal server error', {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 500,
    });
  }
};
