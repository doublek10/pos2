import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';

const schema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']).optional() });

/**
 * Owner-only: disable/remove an employee, or edit their status.
 *
 * Was: findFirst (before-state) + prisma.$transaction(async (tx) => {
 * ...update, audit... })
 * Now: one signed call to the PHP gateway's users.update action, which
 * runs the "before" lookup, the update, and the audit log as a single
 * atomic Postgres transaction.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission('users.update');
    const body = schema.parse(await req.json());

    const user = await callGateway('users.update', {
      companyId: session.companyId,
      actorUserId: session.userId,
      userId: params.id,
      status: body.status,
    });

    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
