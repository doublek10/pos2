import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';

const schema = z.object({ registerId: z.string(), openingCash: z.number().nonnegative() });

// Was: prisma.$transaction(async (tx) => { ...register lookup, session
// create, register status update, audit... })
// Now: a signed call to the PHP gateway's register.open action, which
// runs the whole thing as a single atomic Postgres transaction.
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('register.open');
    const body = schema.parse(await req.json());

    const registerSession = await callGateway('register.open', {
      companyId: session.companyId,
      actorUserId: session.userId,
      registerId: body.registerId,
      openingCash: body.openingCash,
    });

    return NextResponse.json({ session: registerSession }, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
