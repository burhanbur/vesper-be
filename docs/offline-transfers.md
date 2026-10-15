# Offline atomic transfer commands

## Mobile contract

Send through authenticated `POST /api/v1/sync/push` with an owned `device_id` and an `items` array. Each transfer is **one** item:

```json
{
  "entity_type": "transfers",
  "entity_id": "019a0000-0000-7000-8000-000000000003",
  "operation": "CREATE",
  "client_version": "0",
  "payload": {
    "from_account_id": "019a0000-0000-7000-8000-000000000004",
    "to_account_id": "019a0000-0000-7000-8000-000000000005",
    "from_transaction_id": "019a0000-0000-7000-8000-000000000006",
    "to_transaction_id": "019a0000-0000-7000-8000-000000000007",
    "amount": "25000.00",
    "transacted_at": "2026-10-15T10:00:00.000Z",
    "description": null
  }
}
```

- Persist all three client UUIDs and the payload locally before enqueueing. Transfer ID and both leg IDs must be distinct. Source and destination accounts must differ.
- Amount is a positive decimal string (maximum 18 integer digits and 2 decimal places), never a JSON floating-point number. Timestamp requires millisecond precision and an explicit offset. Description defaults to null; supplied strings are trimmed, nonempty and at most 5000 characters.
- Current authorized access to both active accounts is required, using the same owner/shared-account grant rules as online ledger writes. Both currencies must be IDR. Shared access is not ownership of the command: only its original creator can replay it.
- Only CREATE with client_version `0` is supported. Transfer UPDATE/DELETE and independent transfer-leg mutations remain rejected. Investment writes are unchanged.

## Atomicity and replay

The existing transfer row is the durable command record. Under the sync writer lock and normal account/grant locks, one PostgreSQL transaction creates the parent and exactly two TRANSFER rows: negative source amount and positive destination amount, both with null category. It recomputes both balances using the existing exact-decimal ledger logic and publishes account/transaction changes before commit. Negative balances remain allowed, matching the existing business rules.

The result at `data.results[index]` has status `applied`, `entity_id`, and `server_data` containing the existing transfer DTO, including `from_transaction_id`, `to_transaction_id`, decimal amount, timestamps, actor fields and transfer version. Match results by index/entity_id, not response order alone.

Retry the same IDs and normalized payload after timeouts or lost responses, including from another owned device. An intact matching persisted transfer returns applied without inserts, balance/version bumps or new sync events. Decimal and timestamp comparisons are semantic. Replay does not depend on the latest sync event or device. A changed payload, changed leg IDs, deleted/malformed transfer, or another creator is a conflict without foreign server_data. Colliding ledger IDs are conflicts and roll back the entire command. Invalid fields/access are rejected. Unexpected infrastructure errors return HTTP 500; earlier independent batch items may already be committed and must be replayed.

No new table or migration is required. No database commands need to be applied.

## Pull and local reconciliation

Pull remains backward-compatible: `transactions` contains the two legs (each with transfer_id), and `accounts` contains authoritative balances/versions. There is **no transfers pull entity**. Events are committed together, but pagination can split the pair and shared recipients may only see their authorized leg. Do not assume a page includes both legs or use transaction event versions as account versions.

Upsert local optimistic rows by the supplied ledger UUIDs to avoid duplicates. Never enqueue the two legs as standalone transactions. Reconcile authoritative account balances without applying the optimistic delta twice. Persist pull next_version only after applying its page. Keep the command/payload until applied or an explicitly handled terminal conflict/rejection; a pull alone is not command acknowledgement.

## Validation scope

Database-free regression tests cover schema restrictions, paired signed UUIDs, transaction boundary, replay without writes, collisions/malformed pairs, revoked access, failure propagation and OpenAPI generation. These do not prove PostgreSQL rollback, concurrent execution, or publication integration against a live database; those require an isolated PostgreSQL test environment. Existing sync publication and ledger recomputation paths are reused rather than duplicated.
