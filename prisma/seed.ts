import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  AccountTypeCategory,
  CategoryType,
  InstrumentType,
  ProfileGender,
  UserStatus,
} from '../src/generated/prisma/enums.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to run the seed.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const roles = [
  { id: '0199a1b0-0000-7000-8000-000000000001', code: 'SA', name: 'Super Admin' },
  { id: '0199a1b0-0000-7000-8000-000000000002', code: 'ADM', name: 'Administrator' },
  { id: '0199a1b0-0000-7000-8000-000000000003', code: 'USR', name: 'User' },
] as const;

type RoleCode = 'SA' | 'ADM' | 'USR';

interface RoutePermissionDefinition {
  id: string;
  name: string;
  method: string;
  module: string;
  description: string;
  roles: readonly RoleCode[];
}

const permissions: readonly RoutePermissionDefinition[] = [
  // 1. Users
  {
    id: '0199a1b1-0000-7000-8000-000000000001',
    name: 'user.index',
    method: 'GET',
    module: 'Users',
    description: 'Melihat dan mencari daftar pengguna',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000002',
    name: 'user.create',
    method: 'GET',
    module: 'Users',
    description: 'Mengunduh template impor data pengguna',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000003',
    name: 'user.store',
    method: 'POST',
    module: 'Users',
    description: 'Membuat akun pengguna baru',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000004',
    name: 'user.edit',
    method: 'GET',
    module: 'Users',
    description: 'Mengakses kapabilitas formulir edit pengguna',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000005',
    name: 'user.update',
    method: 'PATCH',
    module: 'Users',
    description: 'Memperbarui informasi data pengguna',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000006',
    name: 'user.destroy',
    method: 'DELETE',
    module: 'Users',
    description: 'Menghapus akun pengguna dari sistem',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000012',
    name: 'user.show',
    method: 'GET',
    module: 'Users',
    description: 'Melihat detail data satu pengguna',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000013',
    name: 'user.export',
    method: 'GET',
    module: 'Users',
    description: 'Mengekspor data daftar pengguna ke format Excel',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000014',
    name: 'user.import',
    method: 'POST',
    module: 'Users',
    description: 'Mengimpor data daftar pengguna dari berkas Excel',
    roles: ['SA', 'ADM'],
  },

  // 2. Files
  {
    id: '0199a1b1-0000-7000-8000-000000000007',
    name: 'file.index',
    method: 'GET',
    module: 'Files',
    description: 'Melihat daftar berkas tersimpan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000008',
    name: 'file.store',
    method: 'POST',
    module: 'Files',
    description: 'Mengunggah berkas baru ke penyimpanan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000009',
    name: 'file.show',
    method: 'GET',
    module: 'Files',
    description: 'Melihat metadata berkas tersimpan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000010',
    name: 'file.download',
    method: 'GET',
    module: 'Files',
    description: 'Mengunduh isi berkas fisik',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000011',
    name: 'file.destroy',
    method: 'DELETE',
    module: 'Files',
    description: 'Menghapus berkas dari penyimpanan',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 3. Auth
  {
    id: '0199a1b1-0000-7000-8000-000000000015',
    name: 'auth.me',
    method: 'GET',
    module: 'Auth',
    description: 'Melihat informasi sesi dan akun pengguna yang sedang aktif',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000016',
    name: 'auth.logout',
    method: 'POST',
    module: 'Auth',
    description: 'Mengakhiri sesi autentikasi dan mencabut refresh token',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 4. Profiles
  {
    id: '0199a1b1-0000-7000-8000-000000000017',
    name: 'profile.show',
    method: 'GET',
    module: 'Profiles',
    description: 'Melihat profil lengkap pengguna saat ini',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000018',
    name: 'profile.update',
    method: 'PATCH',
    module: 'Profiles',
    description: 'Memperbarui data profil preferensi pengguna',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 5. Devices
  {
    id: '0199a1b1-0000-7000-8000-000000000019',
    name: 'device.index',
    method: 'GET',
    module: 'Devices',
    description: 'Melihat daftar perangkat terdaftar milik pengguna',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000020',
    name: 'device.store',
    method: 'POST',
    module: 'Devices',
    description: 'Mendaftarkan instalasi perangkat baru untuk push notification / sinkronisasi',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 6. AccountTypes
  {
    id: '0199a1b1-0000-7000-8000-000000000021',
    name: 'account_type.index',
    method: 'GET',
    module: 'AccountTypes',
    description: 'Melihat daftar tipe akun rekening keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000022',
    name: 'account_type.store',
    method: 'POST',
    module: 'AccountTypes',
    description: 'Membuat tipe akun keuangan baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000023',
    name: 'account_type.update',
    method: 'PATCH',
    module: 'AccountTypes',
    description: 'Memperbarui nama atau keterangan tipe akun keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000024',
    name: 'account_type.destroy',
    method: 'DELETE',
    module: 'AccountTypes',
    description: 'Menghapus tipe akun keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 7. Accounts
  {
    id: '0199a1b1-0000-7000-8000-000000000025',
    name: 'account.index',
    method: 'GET',
    module: 'Accounts',
    description: 'Melihat daftar akun rekening beserta posisi saldo',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000026',
    name: 'account.store',
    method: 'POST',
    module: 'Accounts',
    description: 'Membuat akun atau rekening baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000027',
    name: 'account.update',
    method: 'PATCH',
    module: 'Accounts',
    description: 'Memperbarui data dan konfigurasi akun rekening',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000028',
    name: 'account.destroy',
    method: 'DELETE',
    module: 'Accounts',
    description: 'Menghapus akun atau rekening keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 8. Categories
  {
    id: '0199a1b1-0000-7000-8000-000000000029',
    name: 'category.index',
    method: 'GET',
    module: 'Categories',
    description: 'Melihat daftar kategori pemasukan dan pengeluaran',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000030',
    name: 'category.store',
    method: 'POST',
    module: 'Categories',
    description: 'Membuat kategori transaksi baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000031',
    name: 'category.update',
    method: 'PATCH',
    module: 'Categories',
    description: 'Memperbarui nama atau jenis kategori transaksi',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000032',
    name: 'category.destroy',
    method: 'DELETE',
    module: 'Categories',
    description: 'Menghapus kategori transaksi',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 9. Transactions
  {
    id: '0199a1b1-0000-7000-8000-000000000033',
    name: 'transaction.index',
    method: 'GET',
    module: 'Transactions',
    description: 'Melihat daftar dan filter riwayat transaksi keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000034',
    name: 'transaction.store',
    method: 'POST',
    module: 'Transactions',
    description: 'Mencatat transaksi pemasukan atau pengeluaran baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000035',
    name: 'transaction.update',
    method: 'PATCH',
    module: 'Transactions',
    description: 'Memperbarui catatan transaksi keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000036',
    name: 'transaction.destroy',
    method: 'DELETE',
    module: 'Transactions',
    description: 'Menghapus catatan transaksi keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 10. Transfers
  {
    id: '0199a1b1-0000-7000-8000-000000000037',
    name: 'transfer.store',
    method: 'POST',
    module: 'Transfers',
    description: 'Mencatat transaksi transfer saldo antar rekening',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 11. Budgets
  {
    id: '0199a1b1-0000-7000-8000-000000000038',
    name: 'budget.index',
    method: 'GET',
    module: 'Budgets',
    description: 'Melihat daftar rencana anggaran bulanan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000039',
    name: 'budget.store',
    method: 'POST',
    module: 'Budgets',
    description: 'Membuat rencana anggaran bulanan baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000040',
    name: 'budget.update',
    method: 'PATCH',
    module: 'Budgets',
    description: 'Memperbarui batas alokasi rencana anggaran',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000041',
    name: 'budget.destroy',
    method: 'DELETE',
    module: 'Budgets',
    description: 'Menghapus rencana anggaran',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000042',
    name: 'budget.progress',
    method: 'GET',
    module: 'Budgets',
    description: 'Melihat status penyerapan dan sisa kuota anggaran',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 12. Investments
  {
    id: '0199a1b1-0000-7000-8000-000000000043',
    name: 'investment.instrument.index',
    method: 'GET',
    module: 'Investments',
    description: 'Melihat katalog instrumen pasar modal dan investasi',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000044',
    name: 'investment.instrument.store',
    method: 'POST',
    module: 'Investments',
    description: 'Mendaftarkan instrumen investasi baru ke katalog global',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000045',
    name: 'investment.price.index',
    method: 'GET',
    module: 'Investments',
    description: 'Melihat riwayat harga pasar instrumen investasi',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000046',
    name: 'investment.price.store',
    method: 'POST',
    module: 'Investments',
    description: 'Mencatat atau memperbarui harga pasar harian instrumen',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000047',
    name: 'investment.transaction.store',
    method: 'POST',
    module: 'Investments',
    description: 'Mencatat transaksi beli atau jual aset investasi',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000048',
    name: 'investment.holding.index',
    method: 'GET',
    module: 'Investments',
    description: 'Melihat portofolio kepemilikan aset investasi per akun rekening',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000049',
    name: 'investment.snapshot.index',
    method: 'GET',
    module: 'Investments',
    description: 'Melihat snapshot tren total nilai portofolio investasi harian',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 13. Groups (Household)
  {
    id: '0199a1b1-0000-7000-8000-000000000050',
    name: 'group.index',
    method: 'GET',
    module: 'Groups',
    description: 'Melihat daftar grup keuangan bersama pengguna',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000051',
    name: 'group.store',
    method: 'POST',
    module: 'Groups',
    description: 'Membuat grup keuangan bersama (household) baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000052',
    name: 'group.join',
    method: 'POST',
    module: 'Groups',
    description: 'Bergabung ke grup keuangan via kode undangan bersama',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000053',
    name: 'group.member.index',
    method: 'GET',
    module: 'Groups',
    description: 'Melihat daftar anggota dalam satu grup keuangan',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000054',
    name: 'group.account.store',
    method: 'POST',
    module: 'Groups',
    description: 'Membagikan rekening akun pribadi ke dalam grup bersama',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000055',
    name: 'group.account.destroy',
    method: 'DELETE',
    module: 'Groups',
    description: 'Membatalkan pembagian rekening dari grup bersama',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000056',
    name: 'group.category.index',
    method: 'GET',
    module: 'Groups',
    description: 'Melihat daftar kategori anggaran dalam grup bersama',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000057',
    name: 'group.category.store',
    method: 'POST',
    module: 'Groups',
    description: 'Menambahkan kategori anggaran baru ke grup bersama',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000058',
    name: 'group.category.update',
    method: 'PATCH',
    module: 'Groups',
    description: 'Memperbarui nama atau status kategori anggaran grup',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000059',
    name: 'group.category.destroy',
    method: 'DELETE',
    module: 'Groups',
    description: 'Menghapus kategori anggaran grup bersama',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000060',
    name: 'group.mapping.store',
    method: 'POST',
    module: 'Groups',
    description: 'Menghubungkan kategori pribadi ke kategori anggaran grup',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000061',
    name: 'group.mapping.destroy',
    method: 'DELETE',
    module: 'Groups',
    description: 'Menghapus pemetaan kategori pribadi dari kategori grup',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000062',
    name: 'group.report.index',
    method: 'GET',
    module: 'Groups',
    description: 'Melihat rekapitulasi realisasi anggaran belanja bersama grup',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 14. Sync
  {
    id: '0199a1b1-0000-7000-8000-000000000063',
    name: 'sync.pull',
    method: 'GET',
    module: 'Sync',
    description: 'Mengambil perubahan data transaksi terbaru dari server (pull cursor)',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000064',
    name: 'sync.push',
    method: 'POST',
    module: 'Sync',
    description: 'Mengirim mutasi perubahan data transaksi offline ke server (push batch)',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 15. Notifications
  {
    id: '0199a1b1-0000-7000-8000-000000000065',
    name: 'notification.index',
    method: 'GET',
    module: 'Notifications',
    description: 'Melihat daftar notifikasi dan pengingat pengguna',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000066',
    name: 'notification.read',
    method: 'PATCH',
    module: 'Notifications',
    description: 'Menandai notifikasi sebagai telah dibaca',
    roles: ['SA', 'ADM', 'USR'],
  },

  // 16. ApiKeys
  {
    id: '0199a1b1-0000-7000-8000-000000000067',
    name: 'api_key.index',
    method: 'GET',
    module: 'ApiKeys',
    description: 'Melihat daftar kunci API (API keys) terdaftar',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000068',
    name: 'api_key.store',
    method: 'POST',
    module: 'ApiKeys',
    description: 'Membuat kunci API baru',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000069',
    name: 'api_key.show',
    method: 'GET',
    module: 'ApiKeys',
    description: 'Melihat informasi detail kunci API',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000070',
    name: 'api_key.update',
    method: 'PATCH',
    module: 'ApiKeys',
    description: 'Memperbarui status aktif atau label kunci API',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000071',
    name: 'api_key.destroy',
    method: 'DELETE',
    module: 'ApiKeys',
    description: 'Mencabut dan menghapus kunci API',
    roles: ['SA', 'ADM', 'USR'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000072',
    name: 'api_key.verify',
    method: 'GET',
    module: 'ApiKeys',
    description: 'Memverifikasi kredensial Machine-to-Machine via kunci API',
    roles: ['SA', 'ADM'],
  },

  // 17. Roles (RBAC Management)
  {
    id: '0199a1b1-0000-7000-8000-000000000073',
    name: 'role.index',
    method: 'GET',
    module: 'Roles',
    description: 'Melihat katalog peran dan hierarki sistem',
    roles: ['SA', 'ADM'],
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000074',
    name: 'role.show',
    method: 'GET',
    module: 'Roles',
    description: 'Melihat detail peran dan izin yang diberikan',
    roles: ['SA', 'ADM'],
  },
] as const;

const seedUserData = {
  id: '0199a1b2-0000-7000-8000-000000000001',
  username: 'bmafazi',
  email: 'burhanburdev@gmail.com',
  passwordPlain: 'burhan123',
  name: 'Burhan Mafazi',
  status: UserStatus.ACTIVE,
  profile: {
    fullName: 'Burhan Mafazi',
    gender: ProfileGender.MALE,
    baseCurrency: 'IDR',
    theme: 'system',
  },
};

const seedRefAccountTypes = [
  { id: '0199a1b9-0000-7000-8000-000000000001', name: 'Cash' },
  { id: '0199a1b9-0000-7000-8000-000000000002', name: 'Rekening Bank' },
  { id: '0199a1b9-0000-7000-8000-000000000003', name: 'E-wallet' },
  { id: '0199a1b9-0000-7000-8000-000000000004', name: 'Hutang & Piutang' },
  { id: '0199a1b9-0000-7000-8000-000000000005', name: 'Reksadana' },
  { id: '0199a1b9-0000-7000-8000-000000000006', name: 'Saham' },
  { id: '0199a1b9-0000-7000-8000-000000000007', name: 'Crypto' },
] as const;

const seedRefCategories = [
  // INCOME
  { id: '0199a1ba-0000-7000-8000-000000000001', name: 'Gaji', type: CategoryType.INCOME },
  { id: '0199a1ba-0000-7000-8000-000000000002', name: 'Side Job', type: CategoryType.INCOME },
  { id: '0199a1ba-0000-7000-8000-000000000003', name: 'Bonus', type: CategoryType.INCOME },
  { id: '0199a1ba-0000-7000-8000-000000000004', name: 'Deviden', type: CategoryType.INCOME },
  { id: '0199a1ba-0000-7000-8000-000000000005', name: 'Lainnya', type: CategoryType.INCOME },
  // EXPENSE
  {
    id: '0199a1ba-0000-7000-8000-000000000006',
    name: 'Makanan & Minuman',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-000000000007',
    name: 'Belanja Bulanan',
    type: CategoryType.EXPENSE,
  },
  { id: '0199a1ba-0000-7000-8000-000000000008', name: 'Transportasi', type: CategoryType.EXPENSE },
  {
    id: '0199a1ba-0000-7000-8000-000000000009',
    name: 'Tagihan & WiFi',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-00000000000a',
    name: 'Keluarga & Orang Tua',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-00000000000b',
    name: 'Kesehatan & Obat',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-00000000000c',
    name: 'Hiburan & Hobi',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-00000000000d',
    name: 'Pendidikan & Kursus',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-00000000000e',
    name: 'Cicilan & Pinjaman',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1ba-0000-7000-8000-00000000000f',
    name: 'Donasi & Zakat',
    type: CategoryType.EXPENSE,
  },
  { id: '0199a1ba-0000-7000-8000-000000000010', name: 'Lain-lain', type: CategoryType.EXPENSE },
] as const;

const seedCategories = [
  // INCOME
  { id: '0199a1b3-0000-7000-8000-000000000001', name: 'Gaji', type: CategoryType.INCOME },
  { id: '0199a1b3-0000-7000-8000-000000000002', name: 'Side Job', type: CategoryType.INCOME },
  { id: '0199a1b3-0000-7000-8000-000000000003', name: 'Bonus', type: CategoryType.INCOME },
  { id: '0199a1b3-0000-7000-8000-000000000004', name: 'Deviden', type: CategoryType.INCOME },
  { id: '0199a1b3-0000-7000-8000-000000000005', name: 'Lainnya', type: CategoryType.INCOME },
  // EXPENSE
  {
    id: '0199a1b3-0000-7000-8000-000000000006',
    name: 'Makanan & Minuman',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-000000000007',
    name: 'Belanja Bulanan',
    type: CategoryType.EXPENSE,
  },
  { id: '0199a1b3-0000-7000-8000-000000000008', name: 'Transportasi', type: CategoryType.EXPENSE },
  {
    id: '0199a1b3-0000-7000-8000-000000000009',
    name: 'Tagihan & WiFi',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-00000000000a',
    name: 'Keluarga & Orang Tua',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-00000000000b',
    name: 'Kesehatan & Obat',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-00000000000c',
    name: 'Hiburan & Hobi',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-00000000000d',
    name: 'Pendidikan & Kursus',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-00000000000e',
    name: 'Cicilan & Pinjaman',
    type: CategoryType.EXPENSE,
  },
  {
    id: '0199a1b3-0000-7000-8000-00000000000f',
    name: 'Donasi & Zakat',
    type: CategoryType.EXPENSE,
  },
  { id: '0199a1b3-0000-7000-8000-000000000010', name: 'Lain-lain', type: CategoryType.EXPENSE },
] as const;

const seedAccountTypes = [
  { id: '0199a1b4-0000-7000-8000-000000000001', name: 'Cash', category: AccountTypeCategory.CASH },
  {
    id: '0199a1b4-0000-7000-8000-000000000002',
    name: 'Rekening Bank',
    category: AccountTypeCategory.CASH,
  },
  {
    id: '0199a1b4-0000-7000-8000-000000000003',
    name: 'E-wallet',
    category: AccountTypeCategory.CASH,
  },
  {
    id: '0199a1b4-0000-7000-8000-000000000004',
    name: 'Reksadana',
    category: AccountTypeCategory.INVESTMENT,
  },
  {
    id: '0199a1b4-0000-7000-8000-000000000005',
    name: 'Saham',
    category: AccountTypeCategory.INVESTMENT,
  },
  {
    id: '0199a1b4-0000-7000-8000-000000000006',
    name: 'Hutang & Piutang',
    category: AccountTypeCategory.CASH,
  },
] as const;

const seedInstruments = [
  {
    id: '0199a1b6-0000-7000-8000-000000000001',
    code: 'TLKM',
    name: 'Telkom Indonesia (Persero) Tbk',
    type: InstrumentType.STOCK,
    currency: 'IDR',
  },
  {
    id: '0199a1b6-0000-7000-8000-000000000002',
    code: 'BBCA',
    name: 'Bank Central Asia Tbk',
    type: InstrumentType.STOCK,
    currency: 'IDR',
  },
  {
    id: '0199a1b6-0000-7000-8000-000000000003',
    code: 'BBNI',
    name: 'Bank Negara Indonesia (Persero) Tbk',
    type: InstrumentType.STOCK,
    currency: 'IDR',
  },
  {
    id: '0199a1b6-0000-7000-8000-000000000004',
    code: 'RD-STAR-STABLE-INCOME',
    name: 'STAR Stable Income',
    type: InstrumentType.MUTUAL_FUND,
    currency: 'IDR',
  },
  {
    id: '0199a1b6-0000-7000-8000-000000000005',
    code: 'RD-SUCORINVEST-STABLE-INCOME',
    name: 'Succorinvest Stable Income',
    type: InstrumentType.MUTUAL_FUND,
    currency: 'IDR',
  },
  {
    id: '0199a1b6-0000-7000-8000-000000000006',
    code: 'RD-DANAMAS',
    name: 'Danamas',
    type: InstrumentType.MUTUAL_FUND,
    currency: 'IDR',
  },
] as const;

type AccountSeedDef = {
  id: string;
  accountTypeName: string;
  parentAccountId?: string | null;
  name: string;
  isIncludeTotal: boolean;
  sequenceOrder: bigint;
};

// Seed accounts ordered so parent accounts are inserted before children
const seedAccounts: AccountSeedDef[] = [
  // 1. Cash (Dompet, Pocket)
  {
    id: '0199a1b5-0000-7000-8000-000000000001',
    accountTypeName: 'Cash',
    name: 'Dompet',
    isIncludeTotal: true,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000002',
    accountTypeName: 'Cash',
    name: 'Pocket',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },

  // 2. Rekening Bank (Mandiri, BCA, BRI, BSI, Jago [Main, Sandang, Pangan, Papan, Travel, Dana Darurat, Sedekah], RDN BCA - Stockbit, RDN BCA - Ajaib, RDN BCA - Bareksa)
  {
    id: '0199a1b5-0000-7000-8000-000000000010',
    accountTypeName: 'Rekening Bank',
    name: 'Mandiri',
    isIncludeTotal: true,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000011',
    accountTypeName: 'Rekening Bank',
    name: 'BCA',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000012',
    accountTypeName: 'Rekening Bank',
    name: 'BRI',
    isIncludeTotal: true,
    sequenceOrder: 3n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000013',
    accountTypeName: 'Rekening Bank',
    name: 'BSI',
    isIncludeTotal: true,
    sequenceOrder: 4n,
  },
  // Parent Jago (parent has isIncludeTotal = false so its children's balances don't double-count)
  {
    id: '0199a1b5-0000-7000-8000-000000000014',
    accountTypeName: 'Rekening Bank',
    name: 'Jago',
    isIncludeTotal: false,
    sequenceOrder: 5n,
  },
  // Jago sub-accounts
  {
    id: '0199a1b5-0000-7000-8000-000000000015',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Main',
    isIncludeTotal: true,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000016',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Sandang',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000017',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Pangan',
    isIncludeTotal: true,
    sequenceOrder: 3n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000018',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Papan',
    isIncludeTotal: true,
    sequenceOrder: 4n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000019',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Travel',
    isIncludeTotal: true,
    sequenceOrder: 5n,
  },
  {
    id: '0199a1b5-0000-7000-8000-00000000001a',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Dana Darurat',
    isIncludeTotal: true,
    sequenceOrder: 6n,
  },
  {
    id: '0199a1b5-0000-7000-8000-00000000001b',
    accountTypeName: 'Rekening Bank',
    parentAccountId: '0199a1b5-0000-7000-8000-000000000014',
    name: 'Sedekah',
    isIncludeTotal: true,
    sequenceOrder: 7n,
  },
  {
    id: '0199a1b5-0000-7000-8000-00000000001c',
    accountTypeName: 'Rekening Bank',
    name: 'RDN BCA - Stockbit',
    isIncludeTotal: true,
    sequenceOrder: 6n,
  },
  {
    id: '0199a1b5-0000-7000-8000-00000000001d',
    accountTypeName: 'Rekening Bank',
    name: 'RDN BCA - Ajaib',
    isIncludeTotal: true,
    sequenceOrder: 7n,
  },
  {
    id: '0199a1b5-0000-7000-8000-00000000001e',
    accountTypeName: 'Rekening Bank',
    name: 'RDN BCA - Bareksa',
    isIncludeTotal: true,
    sequenceOrder: 8n,
  },

  // 3. E-wallet (GoPay, OVO, LinkAja, DANA, ShopeePay)
  {
    id: '0199a1b5-0000-7000-8000-000000000020',
    accountTypeName: 'E-wallet',
    name: 'GoPay',
    isIncludeTotal: true,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000021',
    accountTypeName: 'E-wallet',
    name: 'OVO',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000022',
    accountTypeName: 'E-wallet',
    name: 'LinkAja',
    isIncludeTotal: true,
    sequenceOrder: 3n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000023',
    accountTypeName: 'E-wallet',
    name: 'DANA',
    isIncludeTotal: true,
    sequenceOrder: 4n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000024',
    accountTypeName: 'E-wallet',
    name: 'ShopeePay',
    isIncludeTotal: true,
    sequenceOrder: 5n,
  },

  // 4. Reksadana (Platform accounts: Bareksa, Bibit)
  {
    id: '0199a1b5-0000-7000-8000-000000000030',
    accountTypeName: 'Reksadana',
    name: 'Bareksa',
    isIncludeTotal: true,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000033',
    accountTypeName: 'Reksadana',
    name: 'Bibit',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },

  // 5. Saham (Platform accounts: Stockbit, Bareksa)
  {
    id: '0199a1b5-0000-7000-8000-000000000040',
    accountTypeName: 'Saham',
    name: 'Stockbit',
    isIncludeTotal: true,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000043',
    accountTypeName: 'Saham',
    name: 'Bareksa',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },

  // 6. Hutang & Piutang (Gw ngutang, Gw ngutangin)
  {
    id: '0199a1b5-0000-7000-8000-000000000050',
    accountTypeName: 'Hutang & Piutang',
    name: 'Gw ngutang',
    isIncludeTotal: false,
    sequenceOrder: 1n,
  },
  {
    id: '0199a1b5-0000-7000-8000-000000000051',
    accountTypeName: 'Hutang & Piutang',
    name: 'Gw ngutangin',
    isIncludeTotal: true,
    sequenceOrder: 2n,
  },
];

async function main(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    // 1. Roles
    for (const role of roles) {
      await transaction.role.upsert({
        where: { code: role.code },
        create: role,
        update: { name: role.name, deletedAt: null, deletedBy: null },
      });
    }

    // 2. Authorization Routes & Permissions
    const superAdmin = await transaction.role.findUniqueOrThrow({ where: { code: 'SA' } });
    const admin = await transaction.role.findUniqueOrThrow({ where: { code: 'ADM' } });
    const userRole = await transaction.role.findUniqueOrThrow({ where: { code: 'USR' } });

    const roleMap: Record<RoleCode, { id: string }> = {
      SA: superAdmin,
      ADM: admin,
      USR: userRole,
    };

    for (const permission of permissions) {
      const { roles: assignedRoles, ...routeData } = permission;
      const route = await transaction.authorizationRoute.upsert({
        where: { name: routeData.name },
        create: routeData,
        update: {
          method: routeData.method,
          module: routeData.module,
          description: routeData.description,
          deletedAt: null,
          deletedBy: null,
        },
      });

      for (const roleCode of assignedRoles) {
        const targetRole = roleMap[roleCode];
        await transaction.rolePermission.upsert({
          where: { roleId_routeId: { roleId: targetRole.id, routeId: route.id } },
          create: { roleId: targetRole.id, routeId: route.id },
          update: {},
        });
      }
    }

    // 3. User
    const passwordHash = await argon2.hash(seedUserData.passwordPlain, { type: argon2.argon2id });
    const user = await transaction.user.upsert({
      where: { username: seedUserData.username },
      create: {
        id: seedUserData.id,
        username: seedUserData.username,
        email: seedUserData.email,
        passwordHash,
        name: seedUserData.name,
        status: seedUserData.status,
      },
      update: {
        email: seedUserData.email,
        passwordHash,
        name: seedUserData.name,
        status: seedUserData.status,
        deletedAt: null,
        deletedBy: null,
      },
    });

    // 4. User Profile
    await transaction.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: seedUserData.profile.fullName,
        gender: seedUserData.profile.gender,
        baseCurrency: seedUserData.profile.baseCurrency,
        theme: seedUserData.profile.theme,
      },
      update: {
        fullName: seedUserData.profile.fullName,
        gender: seedUserData.profile.gender,
        baseCurrency: seedUserData.profile.baseCurrency,
        theme: seedUserData.profile.theme,
        deletedAt: null,
      },
    });

    // 5. User Roles (Grant SA & USR to bmafazi)
    for (const role of [superAdmin, userRole]) {
      await transaction.userRole.upsert({
        where: { roleId_userId: { roleId: role.id, userId: user.id } },
        create: { roleId: role.id, userId: user.id },
        update: {},
      });
    }

    // 6. Global Reference Tables (ref_account_types & ref_categories)
    for (const refAccountType of seedRefAccountTypes) {
      await transaction.refAccountType.upsert({
        where: { name: refAccountType.name },
        create: refAccountType,
        update: { name: refAccountType.name },
      });
    }

    for (const refCategory of seedRefCategories) {
      await transaction.refCategory.upsert({
        where: { name_type: { name: refCategory.name, type: refCategory.type } },
        create: refCategory,
        update: { name: refCategory.name, type: refCategory.type },
      });
    }

    // 7. Global Instruments
    for (const instrument of seedInstruments) {
      await transaction.instrument.upsert({
        where: { code: instrument.code },
        create: instrument,
        update: {
          name: instrument.name,
          type: instrument.type,
          currency: instrument.currency,
          deletedAt: null,
        },
      });
    }

    // 8. Categories (User categories from ERD)
    for (const cat of seedCategories) {
      await transaction.category.upsert({
        where: { id: cat.id },
        create: {
          id: cat.id,
          userId: user.id,
          name: cat.name,
          type: cat.type,
          version: 1n,
        },
        update: {
          userId: user.id,
          name: cat.name,
          type: cat.type,
          deletedAt: null,
        },
      });
    }

    // 9. Account Types
    const accountTypeMap = new Map<string, string>();
    for (const at of seedAccountTypes) {
      const record = await transaction.accountType.upsert({
        where: { id: at.id },
        create: {
          id: at.id,
          userId: user.id,
          name: at.name,
          category: at.category,
          version: 1n,
        },
        update: {
          userId: user.id,
          name: at.name,
          category: at.category,
          deletedAt: null,
        },
      });
      accountTypeMap.set(at.name, record.id);
    }

    // 10. Accounts (Tree hierarchy: Parents before Children)
    for (const acc of seedAccounts) {
      const typeId = accountTypeMap.get(acc.accountTypeName);
      if (!typeId) {
        throw new Error(`Account type "${acc.accountTypeName}" not found in seeded account types.`);
      }

      await transaction.account.upsert({
        where: { id: acc.id },
        create: {
          id: acc.id,
          userId: user.id,
          accountTypeId: typeId,
          parentAccountId: acc.parentAccountId ?? null,
          name: acc.name,
          currency: 'IDR',
          balance: '0',
          isVisible: true,
          isIncludeTotal: acc.isIncludeTotal,
          sequenceOrder: acc.sequenceOrder,
          version: 1n,
        },
        update: {
          userId: user.id,
          accountTypeId: typeId,
          parentAccountId: acc.parentAccountId ?? null,
          name: acc.name,
          currency: 'IDR',
          isVisible: true,
          isIncludeTotal: acc.isIncludeTotal,
          sequenceOrder: acc.sequenceOrder,
          deletedAt: null,
        },
      });
    }
  });
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
