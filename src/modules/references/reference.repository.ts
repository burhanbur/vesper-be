import type {
    Prisma,
    PrismaClient,
    RefAccountType,
    RefCategory,
} from '../../generated/prisma/client.js';
import type { ListRefAccountTypesQuery, ListRefCategoriesQuery } from './reference.schema.js';

export type ReferencePage<T> = { items: T[]; total: number };

export interface ReferenceRepository {
    listAccountTypes(query: ListRefAccountTypesQuery): Promise<ReferencePage<RefAccountType>>;
    listCategories(query: ListRefCategoriesQuery): Promise<ReferencePage<RefCategory>>;
}

export class PrismaReferenceRepository implements ReferenceRepository {
    constructor(private readonly client: PrismaClient) { }

    async listAccountTypes(query: ListRefAccountTypesQuery) {
        const where: Prisma.RefAccountTypeWhereInput = {
            ...(query.name === undefined ? {} : { name: { contains: query.name, mode: 'insensitive' } }),
        };
        const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
        const orderBy: Prisma.RefAccountTypeOrderByWithRelationInput[] = [
            query.sort.endsWith('name') ? { name: direction } : { createdAt: direction },
            { id: direction },
        ];
        const [items, total] = await this.client.$transaction(
            [
                this.client.refAccountType.findMany({
                    where,
                    orderBy,
                    skip: (query.page - 1) * query.limit,
                    take: query.limit,
                    select: { id: true, name: true, createdAt: true, updatedAt: true },
                }),
                this.client.refAccountType.count({ where }),
            ],
            { isolationLevel: 'RepeatableRead' },
        );
        return { items, total };
    }

    async listCategories(query: ListRefCategoriesQuery) {
        const where: Prisma.RefCategoryWhereInput = {
            ...(query.name === undefined ? {} : { name: { contains: query.name, mode: 'insensitive' } }),
            ...(query.type === undefined ? {} : { type: query.type }),
        };
        const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
        const orderBy: Prisma.RefCategoryOrderByWithRelationInput[] = [
            query.sort.endsWith('name') ? { name: direction } : { createdAt: direction },
            { id: direction },
        ];
        const [items, total] = await this.client.$transaction(
            [
                this.client.refCategory.findMany({
                    where,
                    orderBy,
                    skip: (query.page - 1) * query.limit,
                    take: query.limit,
                    select: { id: true, name: true, type: true, createdAt: true, updatedAt: true },
                }),
                this.client.refCategory.count({ where }),
            ],
            { isolationLevel: 'RepeatableRead' },
        );
        return { items, total };
    }
}
