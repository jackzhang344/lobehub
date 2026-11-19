// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import type { FileItem } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { FileService } from '@/server/services/file';
import { getNeonImagePreview } from '@/server/services/neonImagePreview';

import { GET } from './route';

const fileServiceMocks = vi.hoisted(() => {
  const instance = {
    createCachedPreSignedUrlForPreview: vi.fn(),
    createDownloadUrl: vi.fn(),
    getFullFileUrl: vi.fn(),
  };

  return {
    FileService: vi.fn(function () {
      return instance;
    }),
    instance,
  };
});

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://451287.xyz' } }));
vi.mock('@/server/services/neonImagePreview', () => ({ getNeonImagePreview: vi.fn() }));

vi.mock('@/database/models/file', () => ({
  FileModel: {
    getFileById: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: fileServiceMocks.FileService,
}));

describe('file proxy route', () => {
  const db = {} as LobeChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getServerDB).mockResolvedValue(db);
    vi.mocked(FileModel.getFileById).mockResolvedValue({
      id: 'file-id',
      name: 'image.png',
      url: 'files/user-id/image.png',
      userId: 'owner-user-id',
    } as FileItem);
    fileServiceMocks.instance.createCachedPreSignedUrlForPreview.mockResolvedValue(
      'https://s3.example.com/presigned-preview-url',
    );
    fileServiceMocks.instance.createDownloadUrl.mockResolvedValue(
      'https://s3.example.com/presigned-download-url',
    );
  });

  it('should redirect to a cached presigned preview URL instead of a public full file URL', async () => {
    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.example.com/presigned-preview-url');
    expect(FileModel.getFileById).toHaveBeenCalledWith(db, 'file-id');
    expect(FileService).toHaveBeenCalledWith(db, 'owner-user-id');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).toHaveBeenCalledWith(
      'files/user-id/image.png',
    );
    expect(fileServiceMocks.instance.getFullFileUrl).not.toHaveBeenCalled();
  });

  it('serves the image under the stable file URL when a regional preview is available', async () => {
    const preview = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'image/png' },
    });
    vi.mocked(getNeonImagePreview).mockResolvedValueOnce(preview);
    const response = await GET(new Request('https://451287.xyz/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });
    expect(response).toBe(preview);
    expect(response.headers.get('location')).toBeNull();
  });

  it('should redirect download requests to a content-disposition attachment URL', async () => {
    const response = await GET(new Request('https://lobehub.com/f/file-id?download=1'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.example.com/presigned-download-url');
    expect(fileServiceMocks.instance.createDownloadUrl).toHaveBeenCalledWith(
      'files/user-id/image.png',
      'image.png',
    );
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
  });
});
