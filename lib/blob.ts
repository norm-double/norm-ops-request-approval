// Thin wrapper around @vercel/blob's put(). Gated on OYO_TEST_DB so tests never
// make a real network call to Vercel Blob -- they get a fake in-memory URL instead.
import path from 'node:path';

/** Thrown when BLOB_READ_WRITE_TOKEN is missing at the moment an upload is attempted. */
export class BlobConfigError extends Error {}

const fakeStore = new Map<string, Buffer>();
let fakeCounter = 0;

/** Mirrors the sanitization the old local-disk uploader applied before writing a filename. */
function safeName(originalName: string): string {
  return path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'evidence';
}

export async function uploadEvidence(buffer: Buffer, originalName: string): Promise<string> {
  const cleanName = safeName(originalName);

  if (process.env.OYO_TEST_DB) {
    fakeCounter += 1;
    const key = `test/${fakeCounter}-${cleanName}`;
    fakeStore.set(key, buffer);
    return `blob://${key}`;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new BlobConfigError(
      'Blob storage is not configured: set the BLOB_READ_WRITE_TOKEN environment variable ' +
        'before executing a request with an evidence upload.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { put } = require('@vercel/blob');
  const key = `evidence/${Date.now()}-${cleanName}`;
  const result = await put(key, buffer, { access: 'public' });
  return result.url as string;
}

/** Test-only accessor so tests can assert the fake store actually received bytes. */
export function __getFakeBlob(key: string): Buffer | undefined {
  return fakeStore.get(key.replace(/^blob:\/\//, ''));
}
