import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';

const schema = z.object({ sessionId: z.string(), closingCash: z.number().nonnegative() });

// Was: manual lookup + permission check + prisma.$transaction(async
// (tx) => { ...session update, register status update, audit... })
// Now: the "who can close this session" ownership check and the
// expected-cash calculation both move into the PHP gateway's
// register.close action (which runs as one atomic Postgres
// transaction) — this route just forwards the caller's session
// identity (userId, role) as params, the same way every other
// permission-gated route already trusts requirePermission()'s result.
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('register.close');
    const body = schema.parse(await req.json());

    const updated = await callGateway('register.close', {
      companyId: session.companyId,
      actorUserId: session.userId,
      actorRole: session.role,
      sessionId: body.sessionId,
      closingCash: body.closingCash,
    });

    return NextResponse.json({ session: updated });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
