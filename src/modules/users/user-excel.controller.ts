import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { sendSuccess } from '../../common/http/api-response.js';
import { XLSX_MIME_TYPE, type UserExcelService } from './user-excel.service.js';

function sendWorkbook(
  response: Parameters<RequestHandler>[1],
  filename: string,
  buffer: Buffer,
): void {
  response.status(200);
  response.attachment(filename);
  response.setHeader('Content-Type', XLSX_MIME_TYPE);
  response.setHeader('Content-Length', buffer.byteLength.toString());
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(buffer);
}

export function createUserExcelController(service: UserExcelService) {
  const exportUsers: RequestHandler = async (_request, response) => {
    response.status(200);
    response.attachment(`users-${new Date().toISOString().slice(0, 10)}.xlsx`);
    response.setHeader('Content-Type', XLSX_MIME_TYPE);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    await service.exportUsers(response);
  };

  const downloadTemplate: RequestHandler = async (_request, response) => {
    const workbook = await service.createTemplate();
    sendWorkbook(response, 'users-import-template.xlsx', workbook);
  };

  const importUsers: RequestHandler = async (request, response) => {
    if (!request.file) {
      throw new AppError({
        statusCode: 422,
        code: 'IMPORT_FILE_REQUIRED',
        message: 'File impor wajib diunggah.',
        errors: { file: ['Pilih file XLSX untuk diimpor.'] },
      });
    }
    const result = await service.importUsers(request.file);
    sendSuccess(request, response, {
      statusCode: 201,
      data: result,
      totalData: result.imported,
      message: `${result.imported} pengguna berhasil diimpor.`,
    });
  };

  return { exportUsers, downloadTemplate, importUsers };
}
