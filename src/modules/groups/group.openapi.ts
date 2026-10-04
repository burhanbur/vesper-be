import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
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
  GroupDtoSchema,
  CreatedGroupDtoSchema,
  GroupMemberDtoSchema,
  GroupCategoryDtoSchema,
  GroupReportDtoSchema,
} from './group.schema.js';

export function registerGroupOpenApi(registry: OpenAPIRegistry): void {
  const id = '019a0000-0000-7000-8000-000000000001';
  const timestamp = '2026-10-04T10:00:00.000Z';
  const group = {
    id,
    name: 'Family',
    is_active: true,
    role: 'OWNER',
    created_at: timestamp,
    updated_at: timestamp,
  };
  const category = {
    id,
    group_id: id,
    name: 'Food',
    type: 'EXPENSE',
    created_at: timestamp,
    updated_at: timestamp,
  };
  const error = (description: string) => ({
    description,
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        example: {
          success: false,
          message: 'Permintaan grup tidak diizinkan.',
          timestamp: '2026-10-04 10:00:00',
        },
      },
    },
  });
  const errors = {
    400: error('Malformed request.'),
    401: error('Invalid session or inactive user. No RBAC required.'),
    403: error(
      'Generic denial: missing/inactive group, invalid join code or insufficient membership/ownership.',
    ),
    404: error('Accessible account not found.'),
    409: error('Mapping/type conflict or bounded code collision exhaustion.'),
    422: error('Invalid input, mismatching category type, or foreign resource.'),
    429: error('Common API limit or join limit (10 per IP per 15 minutes per process).'),
    500: error('Unexpected dependency failure.'),
  };
  const routes: {
    method: 'get' | 'post' | 'patch' | 'delete';
    path: string;
    operationId: string;
    summary: string;
    description: string;
    params?: z.ZodObject;
    query?: z.ZodObject;
    body?: z.ZodType;
    schema: z.ZodType;
    example: unknown;
    created?: boolean;
    paginated?: boolean;
  }[] = [
    {
      method: 'get',
      path: '',
      operationId: 'listJoinedGroups',
      summary: 'List joined groups',
      description: 'Active joined groups only; join codes are omitted. Stable pagination.',
      query: GroupPageSchema,
      schema: z.array(GroupDtoSchema),
      example: [group],
      paginated: true,
    },
    {
      method: 'post',
      path: '',
      operationId: 'createGroup',
      summary: 'Create a group',
      description:
        'Atomically creates group and OWNER membership. Cryptographic 12-character join code is returned only here; at most five unique-code attempts.',
      body: CreateGroupSchema,
      schema: CreatedGroupDtoSchema,
      example: { ...group, code: 'A1B2C3D4E5F6' },
      created: true,
    },
    {
      method: 'post',
      path: '/{id}/join',
      operationId: 'joinGroup',
      summary: 'Join a group',
      description:
        'Code must match this active group. Generic rejection; idempotent membership without role escalation or OWNER demotion. Join attempts are rate limited.',
      params: GroupParamsSchema,
      body: JoinGroupSchema,
      schema: GroupDtoSchema,
      example: { ...group, role: 'MEMBER' },
    },
    {
      method: 'get',
      path: '/{id}/members',
      operationId: 'listGroupMembers',
      summary: 'List active members',
      description:
        'Current membership required. Safe user name and profile full_name/photo only; no email, phone, credentials or code.',
      params: GroupParamsSchema,
      query: GroupPageSchema,
      schema: z.array(GroupMemberDtoSchema),
      example: [
        {
          user_id: id,
          role: 'OWNER',
          name: 'Member',
          profile: { full_name: 'Member', photo: null },
          created_at: timestamp,
        },
      ],
      paginated: true,
    },
    ...(['post', 'delete'] as const).map((method) => ({
      method,
      path: '/{id}/accounts',
      operationId: method === 'post' ? 'shareGroupAccount' : 'unshareGroupAccount',
      summary: method === 'post' ? 'Share own account' : 'Unshare own account',
      description:
        'OWNER or MEMBER can opt in/out only their own active account. Never another member account. Unshare revokes access next request; in-flight writes serialize against revocation.',
      params: GroupParamsSchema,
      body: GroupAccountSchema,
      schema: z.null(),
      example: null,
    })),
    {
      method: 'get',
      path: '/{id}/categories',
      operationId: 'listGroupCategories',
      summary: 'List group categories',
      description: 'Active members may discover paginated group categories for mapping.',
      params: GroupParamsSchema,
      query: GroupPageSchema,
      schema: z.array(GroupCategoryDtoSchema),
      example: [category],
      paginated: true,
    },
    {
      method: 'post',
      path: '/{id}/categories',
      operationId: 'createGroupCategory',
      summary: 'Create group category',
      description: 'OWNER only. Type is the exact ERD INCOME/EXPENSE field.',
      params: GroupParamsSchema,
      body: CreateGroupCategorySchema,
      schema: GroupCategoryDtoSchema,
      example: category,
      created: true,
    },
    {
      method: 'patch',
      path: '/{id}/categories',
      operationId: 'updateGroupCategory',
      summary: 'Update group category',
      description:
        'OWNER only; body group_category_id selects a category within this group. Type changes with existing mappings return 409.',
      params: GroupParamsSchema,
      body: PatchGroupCategorySchema,
      schema: GroupCategoryDtoSchema,
      example: category,
    },
    {
      method: 'delete',
      path: '/{id}/categories',
      operationId: 'deleteGroupCategory',
      summary: 'Delete group category',
      description:
        'OWNER only; body group_category_id. Atomically removes mappings; personal transactions remain untouched. No deleted_at exists on this ERD table.',
      params: GroupParamsSchema,
      body: ManageGroupCategorySchema,
      schema: z.null(),
      example: null,
    },
    ...(['post', 'delete'] as const).map((method) => ({
      method,
      path: '/{id}/categories/{gcId}/mapping',
      operationId: method === 'post' ? 'mapGroupCategory' : 'unmapGroupCategory',
      summary: method === 'post' ? 'Map own category' : 'Unmap own category',
      description:
        'Active member; own active personal category with matching type only. Explicit group_id; unique(group_id,user_category_id). Duplicate same mapping is idempotent, different mapping returns 409. Current mappings reclassify historical live transactions.',
      params: GroupCategoryParamsSchema,
      body: GroupMappingSchema,
      schema: z.null(),
      example: null,
    })),
    {
      method: 'get',
      path: '/{id}/category-report',
      operationId: 'getGroupCategoryReport',
      summary: 'Report shared group categories',
      description:
        'UTC calendar month, not budget anchors. Only live transactions on accounts shared IN THIS GROUP, active owner membership, same-group mappings and matching category/account owner and type. Excludes private accounts, TRANSFER, investment-linked and category-null rows. Decimal string income/expense totals, no currency conversion (current IDR policy).',
      params: GroupParamsSchema,
      query: GroupReportQuerySchema,
      schema: GroupReportDtoSchema,
      example: {
        period: '2026-10',
        categories: [
          {
            group_category_id: id,
            name: 'Food',
            type: 'EXPENSE',
            income: '0.00',
            expense: '25000.00',
          },
        ],
      },
    },
  ];
  for (const route of routes) {
    let totalData = route.example === null ? 0 : 1;
    if (Array.isArray(route.example)) totalData = route.example.length;
    registry.registerPath({
      method: route.method,
      path: `/api/v1/groups${route.path}`,
      operationId: route.operationId,
      tags: ['Groups'],
      summary: route.summary,
      description: route.description,
      security: [{ bearerAuth: [] }],
      request: {
        ...(route.params ? { params: route.params } : {}),
        ...(route.query ? { query: route.query } : {}),
        ...(route.body
          ? { body: { required: true, content: { 'application/json': { schema: route.body } } } }
          : {}),
      },
      responses: {
        ...errors,
        [route.created ? 201 : 200]: {
          description: 'Successful group operation.',
          content: {
            'application/json': {
              schema: createSuccessResponseSchema(route.schema),
              example: {
                success: true,
                message: 'Permintaan berhasil.',
                timestamp: '2026-10-04 10:00:00',
                total_data: totalData,
                data: route.example,
                ...(route.paginated
                  ? {
                      pagination: {
                        total: 1,
                        per_page: 20,
                        current_page: 1,
                        last_page: 1,
                        from: 1,
                        to: 1,
                      },
                    }
                  : {}),
              },
            },
          },
        },
      },
    });
  }
}
