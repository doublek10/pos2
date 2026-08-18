import { PaymentMethod } from '@prisma/client';
import { callGateway, GatewayError } from '@/lib/database/gateway-client';
import { ApiError } from '@/lib/permissions/guard';

export interface CartLineInput {
  productId: string;
  quantity: number;
  /** Optional per-line discount amount in currency units, subject to permission checks upstream. */
  discount?: number;
}

export interface CashPaymentInput {
  method: 'CASH';
  amount: number;
}

export interface CreateSaleInput {
  companyId: string;
  branchId: string;
  cashierId: string; // ALWAYS taken from the session, never the request body — see spec section 17
  customerId?: string;
  items: CartLineInput[];
  /** Cash payments are settled immediately at sale time. Digital payments (M-Pesa/PesaPal/Card)
   *  are created as a separate PENDING PaymentTransaction by the payments/* routes and the sale
   *  is only completed once their webhook confirms payment — see completeSaleFromPayment(). */
  cashPayments?: CashPaymentInput[];
}

/**
 * Creates a sale. If `cashPayments` fully covers the total, the sale is
 * completed synchronously (the common cash-register case). Otherwise the
 * sale is left PENDING for a digital payment to complete it — see the
 * payments/* and webhooks/* routes.
 *
 * Implements the transaction from spec section 22/59: stock is checked
 * and decremented, the sale/items/payments/receipt/audit rows are all
 * written atomically, and any failure rolls the whole thing back so we
 * can never end up with "money received but stock not reduced" or vice
 * versa.
 */
export async function createSale(input: CreateSaleInput) {
  // Was: prisma.$transaction(async (tx) => { ...pricing, sale, stock,
  // payment, receipt, audit... }, { isolationLevel: Serializable })
  //
  // Now: one signed call to the PHP gateway's sales.create action, which
  // runs the ENTIRE thing — pricing, the sale + items, the row-locked
  // stock decrement, payments, receipt numbering, and the audit log — as
  // a single atomic Postgres transaction on the PHP side (including the
  // same Serializable isolation level and retry-on-conflict behavior).
  // It is not split into multiple gateway calls, because that would
  // break the atomicity this operation depends on.
  try {
    return await callGateway('sales.create', {
      companyId: input.companyId,
      branchId: input.branchId,
      cashierId: input.cashierId,
      customerId: input.customerId,
      items: input.items,
      cashPayments: input.cashPayments,
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}

/**
 * Completes a PENDING sale once a digital payment (M-Pesa/PesaPal/Card)
 * has been confirmed by its provider webhook. This is the single place
 * digital payments turn into a completed sale + reduced stock, and it
 * is only ever called from the idempotency-checked webhook handlers —
 * never directly from a browser request.
 *
 * Was: prisma.$transaction(async (tx) => { ...idempotency check, stock,
 * payment, receipt, audit... })
 * Now: one signed call to the PHP gateway's sales.completeFromPayment
 * action, which runs the whole thing as a single atomic Postgres
 * transaction on the PHP side, including the same row-locked
 * idempotency check on the sale itself.
 */
export async function completeSaleFromPayment(params: {
  saleId: string;
  method: PaymentMethod;
  amount: number;
  reference: string;
  cashierId: string;
  branchId: string;
  companyId: string;
}) {
  try {
    return await callGateway('sales.completeFromPayment', {
      saleId: params.saleId,
      method: params.method,
      amount: params.amount,
      reference: params.reference,
      cashierId: params.cashierId,
      branchId: params.branchId,
      companyId: params.companyId,
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}
