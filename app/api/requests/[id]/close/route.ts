import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRole } from '@/lib/role';
import { closeRequest, RequestError } from '@/lib/requests';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const requestId = Number(params.id);
  if (!Number.isInteger(requestId)) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
  }

  const role = getCurrentRole();

  try {
    const updated = closeRequest(requestId, role);
    return NextResponse.json({ request: updated });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Unexpected error closing request' }, { status: 500 });
  }
}
