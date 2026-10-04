import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { GroupService } from './group.service.js';
import {
  CreateGroupSchema,
  JoinGroupSchema,
  GroupPageSchema,
  GroupParamsSchema,
  GroupAccountSchema,
  GroupMappingSchema,
  GroupCategoryParamsSchema,
  CreateGroupCategorySchema,
  PatchGroupCategorySchema,
  ManageGroupCategorySchema,
  GroupReportQuerySchema,
} from './group.schema.js';

export function createGroupController(service: GroupService) {
  const actor = (response: Parameters<RequestHandler>[1]) =>
    (response.locals.auth as AuthPrincipal).id;
  const create: RequestHandler = async (request, response) => {
    const data = await service.create(actor(response), CreateGroupSchema.parse(request.body).name);
    sendSuccess(request, response, { data, statusCode: 201, message: 'Grup berhasil dibuat.' });
  };
  const join: RequestHandler = async (request, response) => {
    const data = await service.join(
      actor(response),
      GroupParamsSchema.parse(request.params).id,
      JoinGroupSchema.parse(request.body).code,
    );
    sendSuccess(request, response, { data, message: 'Berhasil bergabung dengan grup.' });
  };
  const list: RequestHandler = async (request, response) => {
    const result = await service.list(actor(response), GroupPageSchema.parse(request.query));
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Grup berhasil diambil.',
    });
  };
  const members: RequestHandler = async (request, response) => {
    const result = await service.members(
      actor(response),
      GroupParamsSchema.parse(request.params).id,
      GroupPageSchema.parse(request.query),
    );
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Anggota grup berhasil diambil.',
    });
  };
  const share =
    (remove: boolean): RequestHandler =>
    async (request, response) => {
      await service.share(
        actor(response),
        GroupParamsSchema.parse(request.params).id,
        GroupAccountSchema.parse(request.body).account_id,
        remove,
      );
      sendSuccess(request, response, {
        data: null,
        message: 'Pembagian akun berhasil diperbarui.',
      });
    };
  const categories: RequestHandler = async (request, response) => {
    const result = await service.categories(
      actor(response),
      GroupParamsSchema.parse(request.params).id,
      GroupPageSchema.parse(request.query),
    );
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Kategori grup berhasil diambil.',
    });
  };
  const createCategory: RequestHandler = async (request, response) => {
    const data = await service.createCategory(
      actor(response),
      GroupParamsSchema.parse(request.params).id,
      CreateGroupCategorySchema.parse(request.body),
    );
    sendSuccess(request, response, {
      data,
      statusCode: 201,
      message: 'Kategori grup berhasil dibuat.',
    });
  };
  const changeCategory =
    (remove: boolean): RequestHandler =>
    async (request, response) => {
      const { id } = GroupParamsSchema.parse(request.params);
      const input = remove
        ? ManageGroupCategorySchema.parse(request.body)
        : PatchGroupCategorySchema.parse(request.body);
      const { group_category_id: categoryId, ...patch } = input;
      const data = await service.changeCategory(
        actor(response),
        id,
        categoryId,
        remove ? undefined : patch,
      );
      sendSuccess(request, response, { data, message: 'Kategori grup berhasil diperbarui.' });
    };
  const mapping =
    (remove: boolean): RequestHandler =>
    async (request, response) => {
      const { id, gcId } = GroupCategoryParamsSchema.parse(request.params);
      await service.mapping(
        actor(response),
        id,
        gcId,
        GroupMappingSchema.parse(request.body).user_category_id,
        remove,
      );
      sendSuccess(request, response, {
        data: null,
        message: 'Pemetaan kategori berhasil diperbarui.',
      });
    };
  const report: RequestHandler = async (request, response) => {
    const data = await service.report(
      actor(response),
      GroupParamsSchema.parse(request.params).id,
      GroupReportQuerySchema.parse(request.query).period,
    );
    sendSuccess(request, response, { data, message: 'Laporan kategori grup berhasil diambil.' });
  };
  return {
    create,
    join,
    list,
    members,
    share,
    categories,
    createCategory,
    changeCategory,
    mapping,
    report,
  };
}
