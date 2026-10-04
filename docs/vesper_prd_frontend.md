# PRD — Vesper Mobile App (Flutter)

## 1. Ringkasan Produk

Vesper adalah aplikasi pencatatan keuangan harian + wealth management (termasuk investasi: saham, reksadana, crypto, emas) dengan arsitektur **offline-first** — aplikasi harus tetap bisa dipakai penuh tanpa koneksi internet (input transaksi, lihat saldo, dsb), lalu sync ke server ExpressJS saat online. Mendukung fitur **grup** untuk pasutri/keluarga berbagi visibilitas akun tertentu.

Dokumen ini adalah PRD untuk sisi mobile app (Flutter). Untuk kontrak API & business rules sisi server, lihat `vesper_prd_backend.md` — PRD ini mengasumsikan backend tersebut sebagai API yang dikonsumsi.

## 2. Tech Stack & Keputusan Arsitektur

- **Framework**: Flutter
- **Local database (offline storage)**: **Drift** (dibangun di atas SQLite). Alasan: skema Vesper sangat relational (banyak foreign key antar tabel — `transactions → accounts → account_types`, `investment_transactions → instruments`, dst), dan Drift menyediakan type-safety + reactive streams (`watch()` query otomatis memicu rebuild UI saat data lokal berubah) — krusial untuk UX offline-first di mana UI harus langsung mencerminkan write lokal sebelum sync selesai. Struktur tabel lokal mengikuti entity yang di-sync: `accounts`, `account_types`, `categories`, `transactions`, `user_profiles`, plus tabel lokal khusus `sync_queue` (lihat `vesper_erd.dbml`, komentar: "KHUSUS UNTUK DATABASE LOCAL FLUTTER BUKAN UNTUK POSTGRESQL"). Definisikan skema Drift (`.drift` file atau Dart table classes) agar 1:1 dengan kolom-kolom di `vesper_erd.dbml` untuk entity yang masuk scope sync.
- **State management**: **Riverpod** (`flutter_riverpod` + code generation `riverpod_generator`). Alasan: reactive stream dari Drift gampang di-expose lewat `StreamProvider`, compile-safe (error ketauan saat development), dan cocok untuk app dengan banyak provider saling bergantung (auth state, status sync, data per modul). Struktur yang disarankan: 1 provider per repository (AccountsRepository, TransactionsRepository, dst) yang membungkus Drift DAO, dikonsumsi oleh provider UI-level per screen.
- **HTTP client**: untuk komunikasi ke backend ExpressJS, standar REST + JSON.

## 3. Prinsip Arsitektur Offline-First (WAJIB dipegang)

1. **Local-first write**: setiap aksi user (tambah transaksi, edit akun, dll) langsung ditulis ke database lokal dan **langsung terlihat di UI** (optimistic update), TANPA menunggu respons server.
2. **`sync_queue` sebagai outbox**: setiap write lokal juga insert row ke `sync_queue` lokal (`entity_type`, `entity_id`, `operation`, `payload`, `status = PENDING`).
3. **Background sync service**: jalan berkala (atau dipicu saat koneksi kembali / app resume) — proses `sync_queue` yang `PENDING`:
   - Push ke `POST /sync/push` (lihat PRD backend 5.10)
   - Kalau sukses → `status = SYNCED`, hapus/arsipkan dari queue
   - Kalau conflict (409 dari server, version mismatch) → `status = FAILED`, simpan error, **tampilkan ke user** untuk resolusi (lihat bagian 7)
   - Kalau network error → retry dengan `retry_count` naik, backoff
4. **Pull sync**: setelah push sukses (atau terpisah, berkala), panggil `GET /sync/pull?since_version=devices.last_sync_version` → apply setiap perubahan ke DB lokal secara berurutan → update `last_sync_version` lokal.
5. **Scope entity yang di-sync**: `transactions`, `account_types`, `accounts`, `categories`, `user_profiles`. **Entity investasi (`instruments`, `instrument_prices`, `investment_transactions`, `portfolio_daily_snapshots`) TIDAK masuk scope ini — modul investasi bersifat online-required** (keputusan final, lihat 4.7 dan bagian 8).

## 4. Fitur & Layar (Screens)

### 4.1 Onboarding & Auth

- Register, Login, Lupa password
- (Opsional) biometric lock untuk buka app

### 4.2 Dashboard

- Total kekayaan (net worth) — jumlah semua `accounts.balance` dengan `is_include_total = true`, termasuk investment accounts (`market_value` dari snapshot terakhir) dan akun hutang (`Hutang` negatif/positif otomatis mengurangi/menambah via transfers)
- Ringkasan pengeluaran/pemasukan bulan berjalan
- Quick-add transaksi (floating action button)

### 4.3 Accounts

- List akun, **support nested** (parent-child via `parent_account_id`) — tampilkan sebagai expandable group di UI (contoh: "Bank Jago" sebagai header collapsible, dengan "Main", "Sandang", "Pangan", dst sebagai children)
- Saat akun punya children: tampilkan total gabungan di header parent (dihitung dari sum children's balance), parent sendiri `is_include_total = false` jadi tidak dobel dihitung di dashboard
- Reorder via drag (update `sequence_order`)
- Toggle `is_visible` (sembunyikan dari list tanpa hapus data)
- Form tambah/edit akun: pilih `account_type_id`, nama, icon, currency, optional `parent_account_id`

### 4.4 Transaksi

- Form tambah transaksi: pilih akun, kategori, nominal, tanggal, deskripsi
- **Logic penting**: kalau akun yang dipilih adalah shared account (ada di `group_accounts`) dan `current_user` BUKAN owner-nya, dropdown kategori HARUS menampilkan kategori milik **owner akun tersebut**, bukan kategori milik `current_user`. Fetch kategori berdasarkan `account_types.user_id` dari akun terpilih, bukan dari `current_user` secara default.
- **Logic default pocket**: kalau user pilih akun parent yang punya children (misal "Bank Jago"), app otomatis arahkan input ke child default (child dengan `sequence_order` terkecil, atau child bernama "Main" sebagai fallback konvensi — bukan hardcode nama, tapi app boleh beri highlight/prioritas ke child pertama)
- List transaksi per akun, infinite scroll, filter by kategori/tanggal
- Untuk shared account: tampilkan nama pelaku (`created_by` → `users.full_name`) di setiap item transaksi

### 4.5 Transfer

- Form: akun asal, akun tujuan, nominal, deskripsi
- Termasuk UI untuk kasus "Hutang" — bisa dibuat sebagai shortcut khusus di UI ("Catat Utang"/"Catat Piutang") yang di baliknya tetap memanggil endpoint transfer biasa dengan akun `Hutang - Gw ngutang`/`Hutang - Gw ngutangin` sebagai salah satu sisi
- **Privasi di tampilan grup**: saat menampilkan histori transfer ke member grup lain, kalau salah satu akun yang terlibat bukan milik viewer dan tidak ter-share ke grup, tampilkan sebagai "akun pribadi milik {nama}" — bukan nama akun asli. Ini data sudah disamarkan oleh backend di response, app cukup render apa adanya (tidak perlu logic sensor tambahan di client).

### 4.6 Budget

- List budget per kategori, dengan progress bar (terpakai vs `budget_amounts.amount` yang berlaku di periode berjalan)
- Form tambah/edit: pilih kategori, nominal, `period_type`, `anchor_date` (dengan default = hari ini kalau user tidak mengubah)
- Tampilan histori budget per periode (misal lihat performa budget bulan lalu) — ambil dari backend endpoint progress, bukan hitung manual di client (biar konsisten dengan effective-dated `budget_amounts`)

### 4.7 Investasi (Portfolio)

> **Online-required**: semua aksi tulis (BUY/SELL/DIVIDEND, update harga instrumen) WAJIB koneksi internet — tombol/form terkait di-disable dengan pesan jelas ("Butuh koneksi internet untuk mencatat transaksi investasi") kalau device offline. Alasan: `avg_cost_price`/`realized_pl` sensitif urutan transaksi, dan `instrument_prices` adalah data global lintas user yang tidak cocok dengan pola sync offline yang dirancang untuk data personal/grup (detail di PRD backend bagian 3, prinsip #7).
>
> **Tampilan tetap bisa diakses offline (read-only)**: hasil `GET /accounts/:id/holdings` dan `GET /accounts/:id/portfolio-snapshot` boleh di-cache di local storage (sederhana, tidak lewat `sync_queue` — cukup simpan response terakhir) agar user tetap bisa melihat ringkasan portofolio & floating P/L dari data terakhir yang berhasil di-fetch, dengan indikator "data per {waktu terakhir sync}" agar user tahu ini bukan data real-time.

- List holding per akun investasi: instrumen, quantity, avg cost, harga terakhir, floating P/L (warna hijau/merah)
- **Prompt update harga manual**: untuk setiap instrumen yang dipegang user, kalau harga hari ini belum ada (`instrument_prices` untuk tanggal hari ini kosong), tampilkan prompt ringan "Update harga {instrumen} hari ini?" — quick input, bukan form panjang. Kalau sudah ada (baik diinput user ini atau user lain yang juga pegang instrumen sama — karena `instruments`/`instrument_prices` bersifat global), langsung tampilkan P/L tanpa minta input ulang.
- Form transaksi investasi: pilih tipe (BUY/SELL/DIVIDEND), instrumen (dengan search/autocomplete ke `GET /instruments`, opsi "buat instrumen baru" kalau belum ada di hasil pencarian), quantity, harga per unit, fee, akun cash sumber/tujuan dana (opsional untuk DIVIDEND yang di-reinvest)
- Grafik nilai portofolio dari waktu ke waktu (dari `portfolio_daily_snapshots`)

### 4.8 Groups

- Buat grup baru (generate kode), atau join via kode
- Kelola anggota (lihat list, role OWNER/MEMBER)
- Kelola akun yang di-share ke grup (toggle per akun milik sendiri)
- Kelola kategori grup (`group_categories`) + mapping kategori personal ke kategori grup (opsional per user, beri opsi skip)
- Laporan agregat per kategori grup (gabungan transaksi semua member yang kategorinya sudah di-mapping)
- Feed aktivitas shared account: transaksi terbaru di akun bersama, dengan nama pelaku

### 4.9 Settings

- Edit profil (`user_profiles`: nama, foto, gender, `base_currency`, `theme`)
- Kelola device terdaftar (lihat `devices`, opsi logout device lain)
- Status sync (terakhir sync kapan, ada item pending/failed berapa)
- Notifikasi

## 5. UX untuk Konflik Sync

Saat `sync_queue` item berstatus `FAILED` karena version conflict:

- Tampilkan notifikasi/badge jumlah item bermasalah
- Layar resolusi: tampilkan versi lokal vs versi server (minimal untuk field yang beda), opsi "pakai punya saya" (overwrite, kirim ulang dengan version terbaru dari server) atau "pakai punya server" (discard perubahan lokal, replace dengan data server)
- Untuk MVP, strategi default yang disarankan: insert-only data (transaksi baru) jarang konflik (bukan edit row yang sama) — prioritaskan UX resolusi untuk entity yang sering di-edit bareng (`accounts`, `categories`), bukan `transactions` individual.

## 6. Non-Functional Requirements

- **Precision**: gunakan tipe data yang presisi (bukan `double` biasa) untuk nominal uang dan quantity instrumen di local DB — hindari floating point error, terutama untuk crypto (`quantity` butuh hingga 8 desimal).
- **Local DB encryption**: data finansial sensitif, pertimbangkan enkripsi local database (misal SQLCipher) — rekomendasi, bukan hard requirement MVP, tapi dicatat untuk keputusan.
- **Performance**: list transaksi harus tetap responsif untuk histori ribuan row (pagination/lazy load, jangan load semua transaksi ke memory sekaligus).
- **Konsistensi angka dengan backend**: semua perhitungan yang "otoritatif" (balance, floating P/L, budget progress) sebaiknya ditampilkan dari data yang sudah di-sync dari server, bukan dihitung ulang secara independen di client dengan logic yang mungkin berbeda — hindari drift antara angka yang ditampilkan client vs yang sebenarnya tersimpan di server.

## 7. Out of Scope (Phase 2)

- Fitur investasi berjalan offline penuh (tergantung keputusan di Open Questions)
- Push notification real-time
- Multi-currency display/konversi otomatis
- Dark mode detail styling (kolom `theme` di `user_profiles` sudah disiapkan, implementasi UI menyusul)

## 8. Keputusan Final (sebelumnya Open Questions)

- **Local DB engine**: Drift (bagian 2)
- **State management**: Riverpod (bagian 2)
- **Scope sync offline investasi**: online-required, tidak lewat Drift/sync_queue — hanya cache read-only sederhana (bagian 3 & 4.7)

Semua open question dari draft sebelumnya sudah final. Tidak ada tabel Drift lokal untuk entity investasi — data investasi di-fetch langsung dari API saat online, dengan cache read-only sederhana (bukan bagian dari sync engine) untuk tampilan offline.
