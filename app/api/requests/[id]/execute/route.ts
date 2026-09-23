import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRole } from '@/lib/role';
import { executeRequest, RequestError } from '@/lib/requests';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const requestId = Number(params.id);
  if (!Number.isInteger(requestId)) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
  }

  const role = getCurrentRole();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with an evidence file' }, { status: 400 });
  }

  const fileEntry = formData.get('evidence');
  let file: { buffer: Buffer; originalName: string } | null = null;
  if (fileEntry && fileEntry instanceof File) {
    const arrayBuffer = await fileEntry.arrayBuffer();
    file = { buffer: Buffer.from(arrayBuffer), originalName: fileEntry.name };
  }

  try {
    const updated = executeRequest(requestId, role, file);
    return NextResponse.json({ request: updated });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Unexpected error executing request' }, { status: 500 });
  }
}
