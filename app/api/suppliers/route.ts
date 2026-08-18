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

export async function GET() {
  try {
    const session = await requirePermission('suppliers.view');
    const suppliers = await callGateway('suppliers.list', { companyId: session.companyId });
    return NextResponse.json({ suppliers });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('suppliers.create');
    const body = schema.parse(await req.json());
    const supplier = await callGateway('suppliers.create', { companyId: session.companyId, ...body });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
