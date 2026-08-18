import { prisma } from '@/lib/database/client';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';
import { recordAudit } from '@/lib/audit';
import { ApiError } from '@/lib/permissions/guard';

export interface CreateProductInput {
  companyId: string;
  actorUserId: string;
  categoryId?: string;
  brandId?: string;
  name: string;
  description?: string;
  sku: string;
  costPrice: number;
  sellingPrice: number;
  taxRate?: number;
  reorderLevel?: number;
  unit?: string;
  imageUrl?: string;
  barcodes?: string[];
}

/**
 * Was: existence check + prisma.$transaction(async (tx) => { ...create
 * + barcodes, audit... })
 * Now: one signed call to the PHP gateway's products.create action,
 * which runs the SKU-uniqueness check, insert, barcodes, and audit log
 * as a single atomic Postgres transaction.
 */
export async function createProduct(input: CreateProductInput) {
  try {
    return await callGateway('products.create', {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      categoryId: input.categoryId,
      brandId: input.brandId,
      name: input.name,
      description: input.description,
      sku: input.sku,
      costPrice: input.costPrice,
      sellingPrice: input.sellingPrice,
      taxRate: input.taxRate,
      reorderLevel: input.reorderLevel,
      unit: input.unit,
      imageUrl: input.imageUrl,
      barcodes: input.barcodes,
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}

/**
 * Mirrors: the single-product lookup implicit in updateProduct's old
 * "before" fetch — now exposed as its own gateway action so routes
 * that just need to read one product don't have to go through
 * products.list.
 */
export async function getProduct(companyId: string, productId: string) {
  return callGateway('products.get', { companyId, productId });
}

export interface UpdateProductInput {
  companyId: string;
  actorUserId: string;
  productId: string;
  data: Partial<{
    name: string;
    description: string;
    categoryId: string;
    brandId: string;
    costPrice: number;
    sellingPrice: number;
    taxRate: number;
    reorderLevel: number;
    unit: string;
    imageUrl: string;
    isActive: boolean;
  }>;
}

/**
 * Was: findFirst (before-state) + prisma.$transaction(async (tx) => {
 * ...update, audit... })
 * Now: one signed call to the PHP gateway's products.update action,
 * which runs the "before" lookup, the update, and the audit log
 * (PRODUCT_UPDATED vs PRODUCT_PRICE_CHANGED) as a single atomic
 * Postgres transaction.
 */
export async function updateProduct(input: UpdateProductInput) {
  try {
    return await callGateway('products.update', {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      productId: input.productId,
      data: input.data,
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}

/** Deactivate rather than hard-delete — sale history references products by id. */
export async function deactivateProduct(companyId: string, actorUserId: string, productId: string) {
  const before = await prisma.product.findFirst({ where: { id: productId, companyId } });
  if (!before) throw new ApiError(404, 'Product not found');

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
    await recordAudit(tx, {
      companyId,
      userId: actorUserId,
      action: 'PRODUCT_DEACTIVATED',
      entity: 'Product',
      entityId: productId,
      oldData: before,
      newData: product,
    });
    return product;
  });
}

export async function listProducts(companyId: string, opts: { search?: string; branchId?: string } = {}) {
  // Was: prisma.product.findMany({ where: {...}, include: {...} })
  // Now: a signed call to the PHP gateway's products.list action, which
  // runs the equivalent SQL against Postgres and returns the same shape.
  return callGateway('products.list', {
    companyId,
    search: opts.search,
    branchId: opts.branchId,
  });
}

/** Product lookup by exact barcode — the hot path used when a scanner fires. */
export async function findProductByBarcode(companyId: string, barcode: string, branchId: string) {
  const match = await prisma.productBarcode.findUnique({
    where: { barcode },
    include: {
      product: {
        include: { inventory: { where: { branchId } } },
      },
    },
  });
  if (!match || match.product.companyId !== companyId || !match.product.isActive) return null;
  return match.product;
}
