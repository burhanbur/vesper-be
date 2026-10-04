import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { ListDevicesQuery, RegisterDeviceInput } from './device.schema.js';
import type { DeviceService } from './device.service.js';

export function createDeviceController(service: DeviceService) {
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    // The route middleware validates query/body before these controllers execute.
    const validated = response.locals.validated as ValidatedInput;
    const query = validated.query as ListDevicesQuery;
    const result = await service.list(principal.id, query);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Perangkat berhasil diambil.',
    });
  };
  const register: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const input = validated.body as RegisterDeviceInput;
    const result = await service.register(principal.id, input);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.device,
      statusCode: result.created ? 201 : 200,
      message: 'Perangkat berhasil didaftarkan.',
    });
  };
  return { list, register };
}
