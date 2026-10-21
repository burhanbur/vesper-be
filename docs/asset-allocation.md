# Asset allocation and concentration (WM-12)

Open Settings → Alokasi Aset. Refresh from the server for a current owner-only IDR assessment. The last validated server snapshot is stored in the owner's local database and can be read offline. The UI labels cached data, the server observation time, snapshot date, pending local mutations and missing/stale prices. It never adds unsynced deltas to server values or treats a cached assessment as live local balances.

## Scope and denominator

`GET /api/v1/net-worth/allocation?currency=IDR` uses the existing WM-02 repository's single RepeatableRead transaction for owned accounts, position quantities, current instrument metadata, latest dated quotes and WM-06 obligations. Authentication and an active identity are required. Household membership never adds another owner's assets. Unsupported currency, historical dates and user/scope overrides are rejected. No additional RBAC grant, financial mutation, historical capture, migration or new entity is introduced.

Only active owned IDR leaf accounts with `is_include_total` are included. Parent accounts and opted-out leaves are excluded. Positive CASH and INVESTMENT ledger balances both form CASH: uninvested settlement cash is counted once. Negative account balances and payable principal are disclosed as known liabilities outside the denominator, never subtracted from gross assets. Mapped WM-06 account balances are replaced by their obligation component once. Positive receivables form RECEIVABLE. The remaining classes are STOCK, MUTUAL_FUND, CRYPTO, BOND, GOLD and OTHER. Unsupported real-world assets and FX conversion are outside this assessment.

BUY minus SELL quantities are valued at the last quote whose UTC price date is at or before the current UTC date. Dividends change cash, not quantity. Each account/instrument position rounds once to cents using WM-02's existing boundary; those rounded values then sum across accounts for the same instrument. Class metadata is read in the same transaction. The repository's existing 1000-account/obligation and 10000-position-group scope limits remain in effect.

For every class and instrument:

`weight_percent = floor(value_cents × 10000 / gross_positive_asset_cents) / 100`

The denominator includes cash and receivables, so instrument concentration is a share of all supported gross assets, not just investment holdings or net worth. Positive position values, cash and receivables are nonnegative. Financial calculations use exact decimal/integer arithmetic, including amounts above floating-point precision. Independent truncation means displayed shares can sum below 100%.

Missing prices, deleted/unavailable instruments, currency mismatch, invalid negative positions or inconsistent mapped obligations make the assessment partial. Missing class metadata uses UNCLASSIFIED and keeps any known monetary value. Unknown amounts remain null with reasons; known subtotals remain visible. All percentages, target deviations and concentration rankings are withheld for a partial assessment, so the known subset is never rescaled into a misleading 100%. A complete zero-asset assessment also has no percentages or concentration ranking.

A quote dated before the snapshot day is stale. Its value remains provisional with date/source labels and an explicit warning; stale does not mean missing. No external price feed is added. The UI shows each instrument's account count, aggregate quantity, class, known/value amounts and quote evidence. The largest positive instrument and the combined weight of up to the three largest positive instruments describe concentration without prescribing a safe threshold or trade.

## User targets

Targets cover the eight supported asset classes and must sum to exactly 100%. Each entry is 0–100 with at most two decimal places; defaults do not invent an investment strategy. Targets are saved atomically per owner/device, outside the financial sync queue. They persist across restarts but are not synchronized to another device. Users can edit or delete their targets offline. No trade, transfer or other financial row is created.

`deviation_percentage_points = displayed_actual_weight_percent − selected_target_percent`

For a displayed GOLD weight of 50.00% and a user target of 40.00%, deviation is +10.00 percentage points. This is not a 10% relative return or an instruction to buy/sell. Deviations wait for a complete nonzero assessment; stale or cached values remain labelled provisional. Target comparison uses displayed truncated weights so its arithmetic is directly explainable from the screen.

## Privacy, cache and validation

Cached snapshots and targets carry the current owner ID. The mobile parser validates scope/currency, exact totals, unique class/instrument identities, class-to-instrument value agreement and percentage invariants before caching. Invalid responses do not replace a valid cache. Responses arriving after a session change or controller disposal cannot write a cache or publish prior-user data. Authorization failures clear the prior assessment. Hidden-balance mode masks actual amounts, quantities, percentages, target comparisons and concentration bars.

Validation covers both snapshot and encrypted indexed stores, target total/precision validation, signed deviations, zero/partial assessments, atomic rollback, restart/cache behavior, offline reads and stale-session responses. Widget tests cover target forms, cache/stale labels, hidden values, partial results and narrow phone layout. Backend tests cover aggregation/rounding, exact large values, zero denominators, strict HTTP scope/authentication and isolated PostgreSQL owner/household access, mapped liabilities and future/missing/current quote selection. Device/emulator runtime is not claimed.

Deploy the updated backend before refreshing allocation on mobile. No database migration is required for WM-12. Existing WM-06–WM-10 prerequisites still apply to the backend's current schema. The ERD is unchanged by this feature.
