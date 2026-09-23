import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRole } from '@/lib/role';
import { approveOrReject, RequestError } from '@/lib/requests';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const requestId = Number(params.id);
  if (!Number.isInteger(requestId)) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const decision = body?.decision;
  if (decision !== 'Approved' && decision !== 'Rejected') {
    return NextResponse.json(
      { error: 'decision must be "Approved" or "Rejected"' },
      { status: 400 }
    );
  }

  const role = getCurrentRole();

  try {
    const updated = await approveOrReject(requestId, role, decision);
    return NextResponse.json({ request: updated });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Unexpected error recording decision' }, { status: 500 });
  }
}
