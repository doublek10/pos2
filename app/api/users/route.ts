import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';
import { hashPassword } from '@/lib/auth/password';
import { RoleName } from '@prisma/client';

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
  role: z.nativeEnum(RoleName),
});

/**
 * Only the OWNER can create employees (section 2: "Add product
 * managers", "Add cashiers"). Note there is no permission string a
 * PRODUCT_MANAGER or CASHIER role could ever be granted that would let
 * them reach this route, short of an owner explicitly editing
 * ROLE_PERMISSIONS in code — which is the intended way to change
 * policy, not a runtime request.
 *
 * Was: role lookup + prisma.$transaction(async (tx) => { ...user
 * create, audit... })
 * Now: password hashing (bcryptjs) still happens here in Next.js —
 * only the resulting hash crosses the gateway, never a raw password
 * or the hashing algorithm choice. The role lookup, insert, and audit
 * log then run as one atomic Postgres transaction in the PHP gateway's
 * users.create action.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('users.create');
    const body = schema.parse(await req.json());

    if (body.role === 'OWNER') {
      throw new ApiError(400, 'Cannot create additional OWNER accounts through this endpoint');
    }

    const passwordHash = await hashPassword(body.password);

    const user = await callGateway<{ id: string; name: string; email: string; role: string }>(
      'users.create',
      {
        companyId: session.companyId,
        actorUserId: session.userId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash,
        role: body.role,
      }
    );

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}

export async function GET() {
  try {
    const session = await requirePermission('users.view');
    const users = await callGateway('users.list', { companyId: session.companyId });
    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
