import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';

const schema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission('customers.view');
    const search = req.nextUrl.searchParams.get('search') ?? undefined;
    const customers = await callGateway('customers.list', { companyId: session.companyId, search });
    return NextResponse.json({ customers });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('customers.create');
    const body = schema.parse(await req.json());
    const customer = await callGateway('customers.create', { companyId: session.companyId, ...body });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
