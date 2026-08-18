import { prisma } from '@/lib/database/client';

interface AuditInput {
  companyId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string;
  oldData?: unknown;
  newData?: unknown;
  ipAddress?: string | null;
}

/**
 * Writes an audit log row. Called for every state-changing action
 * (section 49 of the spec). Deliberately never throws on its own
 * failure path in callers that wrap it in a transaction — if the
 * write fails it should roll back the whole operation, since an
 * unaudited mutation is itself a compliance problem.
 */
export async function recordAudit(tx: typeof prisma, input: AuditInput) {
  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      oldData: input.oldData as any,
      newData: input.newData as any,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
