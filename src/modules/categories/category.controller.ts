import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type {
  CategoryIdParams,
  CreateCategoryInput,
  DeleteCategoryQuery,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './category.schema.js';
import type { CategoryService } from './category.service.js';

export function createCategoryController(service: CategoryService) {
  // Authentication and route validation establish these locals before execution.
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const result = await service.list(principal.id, validated.query as ListCategoriesQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Kategori berhasil diambil.',
    });
  };
  const create: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const data = await service.create(principal.id, validated.body as CreateCategoryInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, statusCode: 201, message: 'Kategori berhasil dibuat.' });
  };
  const update: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as CategoryIdParams;
    const data = await service.update(principal.id, id, validated.body as UpdateCategoryInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Kategori berhasil diperbarui.' });
  };
  const remove: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as CategoryIdParams;
    const { version } = validated.query as DeleteCategoryQuery;
    await service.delete(principal.id, id, version);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data: null, message: 'Kategori berhasil dihapus.' });
  };
  return { list, create, update, remove };
}
