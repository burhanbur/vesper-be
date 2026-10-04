# PRD — Vesper Backend (ExpressJS)

## 1. Ringkasan Produk

Vesper adalah aplikasi pencatatan keuangan harian sekaligus wealth management, dengan dukungan **offline-first** (client Flutter bisa jalan tanpa koneksi, lalu sync ke server saat online) dan fitur **grup** (pasutri/keluarga berbagi visibilitas akun & kategori).

Backend ini adalah REST API yang melayani aplikasi mobile Flutter. Backend **bukan sumber kebenaran real-time** satu-satunya — client Flutter punya salinan lokal data dan bisa beroperasi offline; backend berperan sebagai **otoritas rekonsiliasi** saat sync terjadi (hitung ulang saldo, deteksi konflik, fan-out perubahan ke anggota grup).

## 2. Tech Stack

- **Runtime**: Node.js + Express.js
- **Database**: PostgreSQL (skema lengkap ada di `vesper_erd.dbml`, jadi acuan utama — jangan buat tabel yang tidak ada di situ tanpa diskusi ulang)
- **Cache/ephemeral store**: Redis — dipakai untuk:
  - Rate limiting per `api_key`/per user
  - Token blacklist (logout/revoke JWT sebelum expired)
  - Cache harga instrumen terakhir (`instrument_prices`) untuk kalkulasi floating P/L yang sering diakses, invalidasi saat ada insert/update harga baru
  - (Opsional, bukan wajib MVP) Pub/Sub untuk notifikasi real-time ke anggota grup lain saat ada transaksi baru di shared account
- **Auth**: JWT (access + refresh token)
- **ORM/Query builder**: bebas dipilih AI agent (Prisma/Knex/Drizzle), asal konsisten dengan tipe data di DBML (terutama `uuid`, `decimal(20,2)`/`decimal(20,8)`, `jsonb`, `timestamptz`)

## 3. Prinsip Arsitektur Inti (WAJIB dipegang, hasil diskusi desain)

Ini bukan opsional — ini keputusan desain yang sudah dibahas panjang dan jadi dasar semua modul di bawah:

1. **`accounts.balance` SELALU di-recompute oleh server dari `SUM(transactions)` yang valid.** Client tidak pernah mengirim nilai balance untuk disimpan langsung — client hanya kirim transaksi, server yang hitung ulang & simpan hasilnya.
2. **Optimistic locking via kolom `version`.** Setiap `UPDATE` ke row yang punya kolom `version` (accounts, categories, transactions, account_types, investment_transactions) wajib: cek `version` yang dikirim client == `version` di DB saat ini. Kalau cocok → apply update, `version + 1`. Kalau tidak cocok → tolak (409 Conflict), kembalikan data terbaru dari server, biarkan client yang memutuskan (overwrite/discard).
3. **Sync fan-out untuk entity yang terhubung ke grup.** Saat ada perubahan pada `accounts`/`transactions`/`transfers`/`investment_transactions` yang akun-nya terdaftar di `group_accounts`, server **wajib** menulis 1 row `sync_changes` untuk **setiap** user yang berhak tahu (owner akun ∪ semua member grup terkait), bukan cuma 1 row untuk si pelaku. Kalau akun itu personal (tidak ada di `group_accounts`), cukup 1 row seperti biasa.
4. **Kategori mengikuti pemilik akun, bukan pelaku transaksi.** Saat user B menginput transaksi di akun bersama milik user A, daftar kategori yang valid untuk dipilih adalah kategori milik **user A** (pemilik akun, via `account_types.user_id`), bukan kategori milik user B. Validasi ini WAJIB dilakukan di server saat `POST /transactions` (jangan percaya `category_id` dari client begitu saja — cek kepemilikan kategorinya).
5. **Privasi akun pribadi di transfer lintas-grup.** Saat transfer menyentuh akun yang tidak ter-share ke grup, dan hasilnya ditampilkan ke member grup lain yang bukan pemilik akun tersebut, nama akun **disamarkan** jadi `"akun pribadi milik {full_name}"` — bukan `accounts.name` asli. Nominal tetap ditampilkan apa adanya, hanya nama akun yang disamarkan. Ini dilakukan di response serialization layer, bukan mengubah data di DB.
6. **Investment transaction selalu membuat row `transactions` turunan.** Lihat detail di bagian 5.8.
7. **Modul investasi bersifat online-required, TIDAK masuk scope sync offline.** Semua write action investasi (`POST /investment-transactions`, `POST /instrument-prices`) hanya bisa dilakukan saat device online — tidak lewat `sync_changes`/`sync_queue`. Alasan: `avg_cost_price`/`realized_pl` sensitif terhadap urutan transaksi, dan `instrument_prices` adalah data global (bukan per-user/per-grup) yang tidak cocok dengan pola fan-out sync yang dirancang untuk entity personal/grup. Endpoint `GET` modul investasi (holdings, portfolio snapshot) tetap bisa dipanggil dan hasilnya boleh di-cache di client untuk tampilan read-only saat offline — itu tanggung jawab client, bukan bagian dari mekanisme sync_changes/sync_queue.

## 4. Autentikasi & Otorisasi

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- Middleware JWT wajib di semua endpoint kecuali auth & health check.
- Otorisasi akses akun (dipakai berulang di banyak modul): user berhak akses akun X jika **dia owner akun itu** (`account_types.user_id == current_user`) **ATAU** akun itu ada di `group_accounts` untuk grup yang dia jadi member-nya (cek via `user_groups`).
- `role_permissions`/`routes`/`roles` (RBAC granular) tersedia di skema untuk kebutuhan admin panel/API partner, tapi **tidak wajib dipakai untuk endpoint user biasa di MVP** — cukup cek `users.is_active` dan JWT valid. RBAC granular dipakai kalau nanti ada endpoint admin/internal.
- `api_keys` dipakai untuk autentikasi machine-to-machine (bukan user login) — middleware terpisah, cek header `X-API-Key`, validasi `is_active`, `expires_at`, `ip_whitelist`.

## 5. Modul & Endpoint

### 5.1 User & Profile

- `GET/PATCH /me` — profil (`user_profiles`)
- `GET/POST /devices` — registrasi device untuk sync

### 5.2 Account Types

- `GET/POST/PATCH/DELETE /account-types`
- `category` (`CASH`/`INVESTMENT`) menentukan logic akun turunannya — validasi tidak boleh diubah kalau sudah ada `accounts` yang pakai (akan merusak logic balance).

### 5.3 Accounts

- `GET /accounts` — support filter `parent_account_id` (buat UI nested), `is_visible`
- `POST/PATCH/DELETE /accounts`
- `GET /accounts/:id/balance-history` (opsional, untuk grafik)
- Saat `parent_account_id` diisi, validasi `account_type_id` parent & child **harus sama** (tidak masuk akal nested beda tipe).

### 5.4 Categories

- `GET/POST/PATCH/DELETE /categories`
- Tidak ada endpoint khusus "kategori grup" di sini — itu masuk modul Groups (5.9).

### 5.5 Transactions

- `GET /transactions` — filter wajib: `account_id`, `category_id`, `date_range`, `type`
- `POST /transactions` — body: `account_id`, `category_id` (opsional untuk TRANSFER, null), `type`, `amount`, `transacted_at`, `description`
  - Validasi: user harus punya akses ke `account_id` (lihat aturan otorisasi di bagian 4)
  - Validasi: `category_id` (kalau diisi) harus milik pemilik `account_id`, bukan milik `current_user` jika beda (lihat prinsip #4)
  - `created_by` = `current_user`, `updated_by` = `current_user`
  - Set `account_id`'s `balance` recompute setelah insert
- `PATCH/DELETE /transactions/:id` — pakai optimistic locking (`version`), `updated_by` di-set ulang

### 5.6 Transfers

- `POST /transfers` — body: `from_account_id`, `to_account_id`, `amount`, `transacted_at`, `description`
  - Validasi: user harus punya akses ke **kedua** akun (lihat prinsip #5 soal privasi untuk kasus akun tidak accessible tapi transfer tetap diizinkan jika salah satu pihak adalah shared account — detail: user hanya butuh akses ke SALAH SATU sisi yang dia inisiasi; akses ke sisi lain ditentukan kebijakan produk — defaultkan ke "harus ada akses ke kedua akun" untuk MVP, dokumentasikan kalau ada perubahan)
  - Otomatis insert 2 row `transactions` (satu `EXPENSE`-like di `from_account_id`, satu `INCOME`-like di `to_account_id`), keduanya dengan `transfer_id` mengarah ke row `transfers` ini
  - `created_by` dicatat di `transfers` DAN diturunkan ke kedua `transactions` yang terbentuk
- **Kasus hutang-piutang**: akun `Hutang` (account_type kategori apa pun, biasanya `CASH`) ditransaksikan via `transfers` biasa — tidak ada tabel/logic khusus. "Gw ngutang" → `transfer(from=Hutang-GwNgutang, to=Dompet)` (saldo Hutang jadi negatif = kewajiban). "Gw ngutangin" → `transfer(from=Dompet, to=Hutang-GwNgutangin)` (saldo jadi positif = piutang).

### 5.7 Budgets

- `GET/POST/PATCH/DELETE /budgets` (tabel `budgets`, field periode: `anchor_date`, `period_type`)
- `budget_amounts` TIDAK di-`UPDATE` langsung. Saat user ubah nominal:
  1. `UPDATE budget_amounts SET effective_to = today() WHERE budget_id = X AND effective_to IS NULL`
  2. `INSERT budget_amounts (budget_id, amount, effective_from = today(), effective_to = NULL)`
- `GET /budgets/:id/progress?period=2026-03` — hitung total transaksi (`category_id` match, `transacted_at` dalam rentang periode yang dihitung dari `anchor_date`+`period_type`) dibanding `amount` yang berlaku di periode tersebut (query `budget_amounts` yang overlap).
- Logic hitung rentang periode dari `anchor_date` + `period_type` (MONTHLY/WEEKLY/DAILY/ANNUAL) harus jadi **shared utility function**, dipakai juga di endpoint lain yang butuh breakdown periode.

### 5.8 Investment

> **Catatan**: Seluruh endpoint `POST`/`PATCH` di modul ini bersifat **online-required** (lihat prinsip #7). Middleware/validasi tambahan tidak diperlukan di server (server selalu online by definition) — ini murni pembatasan di sisi client. Endpoint `GET` di modul ini aman dipanggil kapan saja dan hasilnya boleh di-cache client.

- `GET/POST /instruments` — pencarian/autocomplete (`code`/`name`), insert baru hanya kalau belum ada (`code` unique secara logis, enforce di app layer atau index unique)
- `GET/POST /instrument-prices` — body: `instrument_id`, `price_date`, `close_price`. `source` default `'MANUAL'`, `updated_by = current_user`. Upsert by `(instrument_id, price_date)`.
  - **Setelah insert/update harga berhasil**: trigger regenerasi `portfolio_daily_snapshots` untuk semua `(account_id, instrument_id)` yang memegang instrumen itu pada tanggal tersebut (lihat 5.8.1)
- `POST /investment-transactions` — body: `instrument_id`, `account_id`, `cash_account_id` (nullable), `type` (`BUY`/`SELL`/`DIVIDEND`), `quantity`, `price_per_unit`, `fee`, `transacted_at`
  - **Arah dana berdasarkan `type`**: `BUY` → `cash_account_id` adalah sumber dana (uang keluar); `SELL`/`DIVIDEND` → `cash_account_id` adalah tujuan dana (uang masuk)
  - Jika `cash_account_id` diisi: otomatis insert 1 row `transactions` di `cash_account_id` — `type = EXPENSE` untuk `BUY`, `type = INCOME` untuk `SELL`/`DIVIDEND`. `transactions.category_id` selalu `NULL` untuk row turunan ini. Simpan `linked_transaction_id` di `investment_transactions` mengarah ke row ini.
  - Jika `cash_account_id = NULL` (misal dividen di-reinvest): tidak ada row `transactions` dibuat.
  - `realized_pl` dihitung HANYA untuk `type = SELL`, pakai **average cost method**: `realized_pl = quantity * (price_per_unit - avg_cost_price_saat_itu) - fee`. `avg_cost_price` dihitung dari seluruh histori `BUY` di `(account_id, instrument_id)` tersebut sebelum transaksi SELL ini (weighted average).
- `GET /accounts/:id/holdings` — agregasi `investment_transactions` per `instrument_id` dalam akun tersebut → quantity_held saat ini, avg_cost_price
- `GET /accounts/:id/portfolio-snapshot?date=` — baca dari `portfolio_daily_snapshots`, fallback hitung on-the-fly dari `instrument_prices` terakhir kalau snapshot hari itu belum ada

#### 5.8.1 Regenerasi Portfolio Snapshot (event-triggered, bukan cron — MVP tanpa API eksternal)

Dipicu setiap kali ada `instrument_prices` baru/update:

```
FOR setiap account_id yang punya investment_transactions dengan instrument_id ini:
  quantity_held = SUM(BUY.quantity) - SUM(SELL.quantity) WHERE account_id, instrument_id
  avg_cost_price = weighted average dari seluruh BUY yang masih "aktif" (belum terjual, FIFO atau average — gunakan average)
  market_value = quantity_held * close_price
  unrealized_pl = market_value - (quantity_held * avg_cost_price)
  UPSERT portfolio_daily_snapshots (account_id, instrument_id, snapshot_date = price_date, ...)
```

### 5.9 Groups

- `POST /groups` — generate `code` unique (short alphanumeric, untuk join)
- `POST /groups/:id/join` — body: `code`, insert ke `user_groups` dengan `role = MEMBER`
- `GET /groups/:id/members`
- `POST/DELETE /groups/:id/accounts` — kelola `group_accounts` (opt-in per akun)
- `POST/PATCH/DELETE /groups/:id/categories` — kelola `group_categories`
- `POST/DELETE /groups/:id/categories/:gcId/mapping` — body: `user_category_id`. Insert ke `mapping_group_categories` dengan `group_id` diisi eksplisit (bukan hanya dari `group_category_id`, karena dipakai untuk constraint `UNIQUE(group_id, user_category_id)` — 1 kategori personal max 1 mapping per grup).
- `GET /groups/:id/category-report?period=` — agregasi total transaksi per `group_category_id` (join lewat mapping), lintas semua member

### 5.10 Sync Engine

> **Scope entity**: `transactions`, `account_types`, `accounts`, `categories`, `user_profiles`. Entity investasi (`instruments`, `instrument_prices`, `investment_transactions`, `portfolio_daily_snapshots`) **TIDAK** masuk `sync_changes`/`sync_queue` — lihat prinsip #7.

- `GET /sync/pull?device_id=X&since_version=N` — return semua `sync_changes` dengan `user_id = current_user AND version > N`, urutkan ascending. Response termasuk payload entity terbaru (join ke tabel asalnya berdasarkan `entity_type`+`entity_id`).
- `POST /sync/push` — body: array of `{entity_type, entity_id, operation, payload, client_version}`. Proses satu-satu, apply optimistic locking (prinsip #2). Return per-item status: `applied` / `conflict` (dengan data server terbaru).
- Setelah pull sukses, client update `devices.last_sync_version`.

### 5.11 Notifications

- `GET /notifications`, `PATCH /notifications/:id/read`
- Server generate notification otomatis untuk event tertentu (opsional MVP): member grup baru join, transaksi besar masuk shared account, dll — detail trigger diserahkan ke implementasi, tidak wajib di MVP awal.

## 6. Non-Functional Requirements

- **Precision**: gunakan `decimal`/`numeric` Postgres untuk semua kolom uang (`decimal(20,2)`) dan kuantitas instrumen (`decimal(20,8)`) — JANGAN pakai `float`/`double` di query atau serialization (hindari rounding error).
- **Idempotency**: endpoint `POST /sync/push` harus idempotent per `entity_id` (kalau device retry push yang sama karena network error, tidak boleh dobel insert) — gunakan `entity_id` dari client sebagai primary key (uuid generated client-side), bukan auto-generate di server.
- **Soft delete**: semua tabel dengan `deleted_at` menggunakan soft delete (UPDATE `deleted_at`, bukan DELETE fisik) — konsisten di semua query (default filter `WHERE deleted_at IS NULL`).
- **Currency**: MVP asumsikan semua `instrument.currency` = `account.currency` (IDR). Tidak ada konversi FX.

## 7. Out of Scope (Phase 2 / Technical Debt)

- Integrasi API eksternal untuk harga saham/reksadana/crypto otomatis (MVP: manual input via `instrument_prices.source = MANUAL`)
- Konversi mata uang asing (FX)
- RBAC granular per-route untuk end-user (tabel tersedia, tapi belum wajib dipakai di luar kebutuhan admin)
- Real-time push notification via WebSocket/Pub-Sub (Redis sudah disiapkan untuk ini, implementasi menyusul)

## 8. Keputusan Final (sebelumnya Open Question)

Modul investasi bersifat **online-required**, tidak terhubung ke Sync Engine (modul 5.10). Lihat prinsip #7 di bagian 3 untuk alasan lengkap.
