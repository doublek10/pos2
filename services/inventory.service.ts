import { Prisma, MovementType } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';
import { ApiError } from '@/lib/permissions/guard';

type Tx = Prisma.TransactionClient;

/**
 * Applies a signed quantity delta to a product's stock at a branch and
 * writes the corresponding ledger row, inside an existing transaction.
 *
 * Section 20/60 of the spec: `products.stock_quantity` must never be the
 * sole source of truth, and concurrent sales of the last unit must not
 * be able to drive stock negative. We satisfy both by:
 *   1. Using `SELECT ... FOR UPDATE` (via Prisma's row lock idiom below)
 *      to serialize concurrent writers on the same inventory row.
 *   2. Writing an immutable inventory_movements row for every change.
 *
 * Throws ApiError(409) if the resulting balance would go negative and
 * `allowNegative` is false (the default) — callers running this inside
 * a sale should let that exception roll back the whole transaction.
 */
export async function applyStockMovement(
  tx: Tx,
  params: {
    productId: string;
    branchId: string;
    delta: number; // positive = stock in, negative = stock out
    movementType: MovementType;
    referenceType?: string;
    referenceId?: string;
    allowNegative?: boolean;
  }
) {
  // Row lock: SELECT ... FOR UPDATE via $queryRaw, since Prisma has no
  // first-class lock API. This serializes two concurrent sales of the
  // same product/branch so the read-then-write below can't race.
  const locked = await tx.$queryRaw<{ id: string; quantity: number }[]>(
    Prisma.sql`
      SELECT id, quantity FROM inventory
      WHERE "productId" = ${params.productId} AND "branchId" = ${params.branchId}
      FOR UPDATE
    `
  );

  let inventoryId: string;
  let currentQty: number;

  if (locked.length === 0) {
    // No inventory row yet for this product/branch — create it at zero
    // before applying the movement, so opening stock and first purchase
    // both work without a separate provisioning step.
    const created = await tx.inventory.create({
      data: { productId: params.productId, branchId: params.branchId, quantity: 0 },
    });
    inventoryId = created.id;
    currentQty = 0;
  } else {
    inventoryId = locked[0].id;
    currentQty = locked[0].quantity;
  }

  const balanceAfter = currentQty + params.delta;

  if (balanceAfter < 0 && !params.allowNegative) {
    throw new ApiError(
      409,
      `Insufficient stock: have ${currentQty}, requested ${-params.delta}`
    );
  }

  await tx.inventory.update({
    where: { id: inventoryId },
    data: { quantity: balanceAfter },
  });

  await tx.inventoryMovement.create({
    data: {
      productId: params.productId,
      branchId: params.branchId,
      movementType: params.movementType,
      quantity: params.delta,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      balanceAfter,
    },
  });

  return { balanceAfter };
}

/**
 * Was: prisma.$transaction(async (tx) => { ...product check, stock
 * movement, audit... })
 * Now: one signed call to the PHP gateway's inventory.adjust action,
 * which runs the whole thing as a single atomic Postgres transaction.
 */
export async function adjustStock(input: {
  companyId: string;
  actorUserId: string;
  productId: string;
  branchId: string;
  delta: number;
  reason: string;
}) {
  try {
    return await callGateway<{ balanceAfter: number }>('inventory.adjust', input);
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}

/**
 * Was: prisma.$transaction(async (tx) => { ...purchase + items, stock
 * movement per item, audit... })
 * Now: one signed call to the PHP gateway's inventory.receive action,
 * which runs the whole thing as a single atomic Postgres transaction.
 */
export async function receiveStock(input: {
  companyId: string;
  actorUserId: string;
  supplierId: string;
  branchId: string;
  items: { productId: string; quantity: number; unitCost: number }[];
}) {
  if (input.items.length === 0) throw new ApiError(400, 'Purchase must include at least one item');

  try {
    return await callGateway('inventory.receive', input);
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}

export async function lowStockProducts(companyId: string, branchId?: string) {
  const rows = await prisma.$queryRaw<
    { id: string; name: string; sku: string; reorderLevel: number; quantity: number }[]
  >(Prisma.sql`
    SELECT p.id, p.name, p.sku, p."reorderLevel", COALESCE(SUM(i.quantity), 0)::int AS quantity
    FROM products p
    LEFT JOIN inventory i ON i."productId" = p.id
      ${branchId ? Prisma.sql`AND i."branchId" = ${branchId}` : Prisma.empty}
    WHERE p."companyId" = ${companyId} AND p."isActive" = true
    GROUP BY p.id
    HAVING COALESCE(SUM(i.quantity), 0) <= p."reorderLevel"
    ORDER BY quantity ASC
  `);
  return rows;
}
