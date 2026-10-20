import type { Obligation, ObligationEvent } from '../../generated/prisma/client.js';
export function toObligationDto(row: Obligation) {
  return {
    id: row.id,
    user_id: row.userId,
    kind: row.kind,
    counterparty: row.counterparty,
    currency: row.currency,
    principal: row.principal.toFixed(2),
    outstanding: row.outstanding.toFixed(2),
    due_date: row.dueDate?.toISOString().slice(0, 10) ?? null,
    installments: row.installments,
    linked_account_id: row.linkedAccountId,
    version: row.version.toString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
  };
}
export function toObligationEventDto(row: ObligationEvent) {
  return {
    id: row.id,
    user_id: row.userId,
    obligation_id: row.obligationId,
    operation: row.operation,
    principal: row.principal.toFixed(2),
    interest: row.interest.toFixed(2),
    fee: row.fee.toFixed(2),
    cash_account_id: row.cashAccountId,
    cash_principal_id: row.cashPrincipalId,
    mapped_principal_id: row.mappedPrincipalId,
    interest_id: row.interestId,
    fee_id: row.feeId,
    target_event_id: row.targetEventId,
    transacted_at: row.transactedAt.toISOString(),
    reversed_at: row.reversedAt?.toISOString() ?? null,
    version: row.version.toString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
  };
}
