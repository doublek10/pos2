import { NextResponse } from 'next/server';
import { requirePermission, handleApiError, ApiError } from '@/lib/permissions/guard';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';

/**
 * Owner dashboard summary (spec section 50/68): today's sales, profit,
 * orders, breakdown by payment method, low stock, top cashiers/products.
 *
 * Was: several prisma reads (today's sales + items/payments/cashier,
 * low-stock query) aggregated in this route handler.
 * Now: one signed, read-only call to the PHP gateway's
 * reports.dashboard action, which runs the equivalent queries and
 * aggregation against Postgres directly.
 */
export async function GET() {
  try {
    const session = await requirePermission('reports.view');
    const dashboard = await callGateway('reports.dashboard', { companyId: session.companyId });
    return NextResponse.json(dashboard);
  } catch (err) {
    if (err instanceof GatewayError) {
      return handleApiError(new ApiError(err.status, err.message));
    }
    return handleApiError(err);
  }
}
