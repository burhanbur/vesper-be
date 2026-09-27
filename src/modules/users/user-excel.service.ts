import type { Stream } from 'node:stream';
import argon2 from 'argon2';
import ExcelJS from 'exceljs';
import { AppError } from '../../common/errors/app-error.js';
import { generateId } from '../../common/utils/id.js';
import { config } from '../../config/index.js';
import type { ImportUserRow } from './user-excel.schema.js';
import { ImportUserRowSchema } from './user-excel.schema.js';
import type { UserRepository } from './user.repository.js';

const IMPORT_HEADERS = ['name', 'email', 'password', 'status'] as const;
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

type UserExcelService = {
  exportUsers(destination: Stream): Promise<void>;
  importUsers(file: Express.Multer.File): Promise<{ imported: number; total_rows: number }>;
  createTemplate(): Promise<Buffer>;
};

function normalizeCellValue(cell: ExcelJS.Cell): string {
  return cell.text.trim();
}

function assertXlsx(file: Express.Multer.File): void {
  const hasXlsxSignature = XLSX_SIGNATURES.some((signature) =>
    file.buffer.subarray(0, signature.length).equals(signature),
  );
  if (!hasXlsxSignature) {
    throw new AppError({
      statusCode: 422,
      code: 'INVALID_XLSX_FILE',
      message: 'File harus berformat XLSX yang valid.',
      errors: { file: ['Signature file tidak sesuai dengan format XLSX.'] },
    });
  }
}

async function readImportRows(file: Express.Multer.File): Promise<ImportUserRow[]> {
  assertXlsx(file);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
  } catch (error) {
    throw new AppError({
      statusCode: 422,
      code: 'UNREADABLE_XLSX_FILE',
      message: 'File XLSX tidak dapat dibaca.',
      errors: { file: ['Workbook rusak atau tidak didukung.'] },
      cause: error,
    });
  }

  const worksheet = workbook.getWorksheet('users') ?? workbook.worksheets[0];
  if (!worksheet) {
    throw new AppError({
      statusCode: 422,
      code: 'MISSING_XLSX_WORKSHEET',
      message: 'File XLSX tidak memiliki worksheet.',
      errors: { file: ['Worksheet users tidak ditemukan.'] },
    });
  }

  const headers = IMPORT_HEADERS.map((_, index) =>
    normalizeCellValue(worksheet.getRow(1).getCell(index + 1)).toLowerCase(),
  );
  if (headers.some((header, index) => header !== IMPORT_HEADERS[index])) {
    throw new AppError({
      statusCode: 422,
      code: 'INVALID_XLSX_HEADERS',
      message: 'Header file impor tidak sesuai template.',
      errors: { file: [`Header wajib: ${IMPORT_HEADERS.join(', ')}.`] },
    });
  }

  const candidateRows: { rowNumber: number; values: Record<string, string> }[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const values = Object.fromEntries(
      IMPORT_HEADERS.map((header, index) => [header, normalizeCellValue(row.getCell(index + 1))]),
    );
    if (Object.values(values).some((value) => value.length > 0)) {
      candidateRows.push({ rowNumber, values });
    }
  });

  if (candidateRows.length === 0) {
    throw new AppError({
      statusCode: 422,
      code: 'EMPTY_XLSX_IMPORT',
      message: 'File impor tidak berisi data pengguna.',
      errors: { file: ['Tambahkan minimal satu baris data.'] },
    });
  }
  if (candidateRows.length > config.EXCEL_IMPORT_MAX_ROWS) {
    throw new AppError({
      statusCode: 422,
      code: 'XLSX_ROW_LIMIT_EXCEEDED',
      message: 'Jumlah baris impor melebihi batas.',
      errors: { file: [`Maksimal ${config.EXCEL_IMPORT_MAX_ROWS} baris per file.`] },
    });
  }

  const errors: Record<string, string[]> = {};
  const parsedRows: ImportUserRow[] = [];
  const seenEmails = new Set<string>();

  for (const candidate of candidateRows) {
    const parsed = ImportUserRowSchema.safeParse(candidate.values);
    if (!parsed.success) {
      errors[`rows.${candidate.rowNumber}`] = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`,
      );
      continue;
    }
    if (seenEmails.has(parsed.data.email)) {
      errors[`rows.${candidate.rowNumber}`] = ['Email duplikat di dalam file impor.'];
      continue;
    }
    seenEmails.add(parsed.data.email);
    parsedRows.push(parsed.data);
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError({
      statusCode: 422,
      code: 'XLSX_ROW_VALIDATION_FAILED',
      message: 'Validasi data impor gagal.',
      errors,
    });
  }
  return parsedRows;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
}

export function createUserExcelService(userRepository: UserRepository): UserExcelService {
  return {
    async exportUsers(destination) {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: destination,
        useStyles: true,
        useSharedStrings: false,
      });
      const worksheet = workbook.addWorksheet('users');
      worksheet.columns = [
        { header: 'id', key: 'id', width: 38 },
        { header: 'name', key: 'name', width: 28 },
        { header: 'email', key: 'email', width: 34 },
        { header: 'status', key: 'status', width: 14 },
        { header: 'created_at', key: 'createdAt', width: 26 },
        { header: 'updated_at', key: 'updatedAt', width: 26 },
      ];
      styleHeader(worksheet.getRow(1));
      worksheet.getRow(1).commit();

      let cursor: string | undefined;
      do {
        const page = await userRepository.findExportBatch({
          limit: config.EXCEL_EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        for (const user of page) {
          worksheet
            .addRow({
              id: user.id,
              name: user.name,
              email: user.email,
              status: user.status,
              createdAt: user.createdAt.toISOString(),
              updatedAt: user.updatedAt.toISOString(),
            })
            .commit();
        }
        cursor = page.at(-1)?.id;
        if (page.length < config.EXCEL_EXPORT_BATCH_SIZE) {
          cursor = undefined;
        }
      } while (cursor);

      worksheet.commit();
      await workbook.commit();
    },

    async importUsers(file) {
      const rows = await readImportRows(file);
      const existingEmails = await userRepository.findExistingEmails(rows.map((row) => row.email));
      if (existingEmails.length > 0) {
        throw new AppError({
          statusCode: 409,
          code: 'IMPORTED_EMAIL_CONFLICT',
          message: 'Sebagian email sudah digunakan.',
          errors: {
            email: existingEmails.map((email) => `Email ${email} sudah digunakan.`),
          },
        });
      }

      const users = [];
      for (const row of rows) {
        users.push({
          id: generateId(),
          name: row.name,
          email: row.email,
          status: row.status,
          passwordHash: await argon2.hash(row.password, { type: argon2.argon2id }),
        });
      }
      await userRepository.createMany(users);
      return { imported: rows.length, total_rows: rows.length };
    },

    async createTemplate() {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('users');
      worksheet.columns = IMPORT_HEADERS.map((header) => ({
        header,
        key: header,
        width: header === 'email' ? 32 : 24,
      }));
      styleHeader(worksheet.getRow(1));
      worksheet.addRow({
        name: 'Budi Santoso',
        email: 'budi@example.com',
        password: 'password-kuat',
        status: 'ACTIVE',
      });
      for (let rowNumber = 2; rowNumber <= config.EXCEL_IMPORT_MAX_ROWS + 1; rowNumber += 1) {
        worksheet.getCell(`D${rowNumber}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: ['"ACTIVE,INACTIVE,SUSPENDED"'],
        };
      }
      workbook.creator = config.APP_NAME;
      workbook.created = new Date();
      return Buffer.from(await workbook.xlsx.writeBuffer());
    },
  };
}

export { XLSX_MIME_TYPE };
export type { UserExcelService };
