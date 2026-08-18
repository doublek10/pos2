import { NextResponse } from 'next/server';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';

/**
 * Owner-only view of the full audit trail (spec section 49).
 *
 * Was: prisma.auditLog.findMany({ ...include user, orderBy, take: 200 })
 * Now: one signed, read-only call to the PHP gateway's auditLogs.list
 * action, which runs the equivalent query against Postgres directly.
 */
export async function GET() {
  try {
    const session = await requirePermission('audit.view');
    const logs = await callGateway('auditLogs.list', { companyId: session.companyId });
    return NextResponse.json({ logs });
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
