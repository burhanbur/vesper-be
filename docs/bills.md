# Bills and recurring transactions (WM-10)

Open Settings → Tagihan & Jadwal. Create an owner-private IDR income/expense schedule with an owned leaf cash account, matching category, fixed or estimated amount, start date, optional inclusive end date and reminder settings. Changes save to SQLite before entering the sync queue. Sync a new schedule before recording its payments.

Supported recurrence: once, weekly, monthly and yearly. Dates use the selected fixed UTC/WIB/WITA/WIT offset, without daylight saving. Monthly/yearly dates clamp the original anchor day to the last available day, so January 31 becomes February 28/29 and then March 31. Title, reminders and active status are editable; archive and create a new series to change financial or recurrence terms. Archived history remains available.

The default open view covers the last 365 days and next 60 days, plus every outstanding once-only bill. Enable older arrears to start at the series anchor. Generation is bounded at 10,000 entries and reports when that limit is exceeded. History shows stored paid/skipped events, including archived series.

Reminders appear only inside the application, with configurable 0–30 lead days and a local per-device read state. There is no OS notification permission request, background delivery, autopay or automatic financial mutation. One outstanding event per series is surfaced in the default window; older recurring arrears remain accessible through the older-arrears view.

Every payment requires confirmation. Fixed amounts must match; estimates require the actual amount. Regular payment entry uses whole Rupiah, with exact integer minor-unit arithmetic. The backend accepts exact decimal strings. Skip requires a reason and creates no transaction. Linking an existing matching transaction creates no additional expense. Linked debt schedules snapshot WM-06's explicit principal/date installments: record repayment in Utang & Piutang, then link its evidence. A repayment can cover several installments only within its total principal.

Occurrence IDs are UUIDv5(schedule ID, due date). Immutable command and ledger UUIDs survive retries and restarts. The backend serializes sync, persists command receipts and reserves cancelled IDs. A second device's payment conflicts with the existing paid event; the UI can adopt authoritative state. Retry preserves command identity; cancellation is a separate request and never reverses an applied payment. Outbox locks remain until authoritative account, occurrence and ledger snapshots are durably reconciled.

Correcting/deleting linked transactions or reversing loan repayments marks their bill evidence NEEDS_REVIEW. Reopen/relink explicitly after correction; reopening does not undo money movements. Rejected/conflicting schedule metadata supports retry or adoption of the server state. Unknown-delivery financial commands must use receipt reconciliation/cancellation, not metadata discard.

Backend rollout requires migration `20261021030000_bills`, Prisma generation and backend restart. Migration was exercised on isolated PostgreSQL only; the daily database is left untouched. Widget tests cover payment confirmation/history, form error handling and session privacy. Device/emulator runtime and OS notifications are not claimed.
