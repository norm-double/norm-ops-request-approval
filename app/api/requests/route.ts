import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRole } from '@/lib/role';
import { canCreate, createRequest, RequestError } from '@/lib/requests';

export async function POST(req: NextRequest) {
  const role = getCurrentRole();
  if (!canCreate(role)) {
    return NextResponse.json(
      { error: 'Only the Requester role can create requests' },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const request = await createRequest({
      type: body.type,
      title: body.title,
      description: body.description ?? '',
      amount: body.amount,
      requester: body.requester,
    });
    return NextResponse.json({ request }, { status: 201 });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Unexpected error creating request' }, { status: 500 });
  }
}
