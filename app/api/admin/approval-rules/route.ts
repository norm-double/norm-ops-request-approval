import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRole } from '@/lib/role';
import { canAdmin, getApprovalRules, RequestError, setApprovalRule } from '@/lib/requests';

export async function GET() {
  const role = getCurrentRole();
  if (!canAdmin(role)) {
    return NextResponse.json({ error: 'Only the Admin role can view approval rules' }, { status: 403 });
  }
  return NextResponse.json({ rules: getApprovalRules() });
}

export async function POST(req: NextRequest) {
  const role = getCurrentRole();
  if (!canAdmin(role)) {
    return NextResponse.json({ error: 'Only the Admin role can change approval rules' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const rules = setApprovalRule(body.type, Number(body.requiredLevels));
    return NextResponse.json({ rules });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Unexpected error updating rule' }, { status: 500 });
  }
}
