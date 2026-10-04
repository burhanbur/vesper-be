import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createDeviceController } from './device.controller.js';
import type { DeviceRepository } from './device.repository.js';
import { ListDevicesQuerySchema, RegisterDeviceSchema } from './device.schema.js';
import { DeviceService } from './device.service.js';

export function createDeviceRouter(repository: DeviceRepository, authService: AuthService): Router {
  const router = Router();
  const controller = createDeviceController(new DeviceService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListDevicesQuerySchema }), controller.list);
  router.post('/', validateRequest({ body: RegisterDeviceSchema }), controller.register);
  return router;
}
