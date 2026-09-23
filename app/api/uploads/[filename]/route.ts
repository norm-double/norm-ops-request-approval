import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  const safeName = path.basename(params.filename);
  const fullPath = path.join(UPLOADS_DIR, safeName);

  if (!fullPath.startsWith(UPLOADS_DIR) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return NextResponse.json({ error: 'Evidence file not found' }, { status: 404 });
  }

  const buffer = fs.readFileSync(fullPath);
  const encodedName = encodeURIComponent(safeName);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
    },
  });
}
