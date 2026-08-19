import type {
  CatalogCameraType,
  CatalogCompatibilityLevel,
  CatalogConfidenceLevel,
  CatalogProtocolType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { AuthError } from '../auth/auth.errors';

const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

const modelInclude = {
  brand: { include: { manufacturer: true } },
  family: true,
  aliasRecords: true,
  variants: {
    include: {
      capabilities: true,
      protocols: true,
      provisioningProfiles: true,
      compatibility: true,
      sources: true,
    },
    orderBy: { identityKey: 'asc' as const },
  },
  sources: true,
} satisfies Prisma.CameraCatalogModelInclude;

export class CameraCatalogService {
  constructor(private readonly prisma: PrismaClient) {}

  async manufacturers(query: { page: number; limit: number; search?: string | undefined }) {
    const where: Prisma.CameraCatalogManufacturerWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { normalizedName: { contains: normalize(query.search) } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cameraCatalogManufacturer.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: 'asc' },
        include: {
          brands: { orderBy: { name: 'asc' }, include: { _count: { select: { models: true } } } },
        },
      }),
      this.prisma.cameraCatalogManufacturer.count({ where }),
    ]);
    return { items, pagination: { ...query, total, pages: Math.ceil(total / query.limit) } };
  }

  async models(query: {
    page: number;
    limit: number;
    search?: string | undefined;
    manufacturerId?: string | undefined;
    brandId?: string | undefined;
    familyId?: string | undefined;
    compatibility?: CatalogCompatibilityLevel | undefined;
    confidence?: CatalogConfidenceLevel | undefined;
    protocol?: CatalogProtocolType | undefined;
    sortBy: 'name' | 'createdAt' | 'updatedAt';
    sortOrder: 'asc' | 'desc';
  }) {
    const search = query.search?.trim();
    const where: Prisma.CameraCatalogModelWhereInput = {
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.familyId ? { familyId: query.familyId } : {}),
      ...(query.manufacturerId ? { brand: { manufacturerId: query.manufacturerId } } : {}),
      ...(query.compatibility || query.confidence || query.protocol
        ? {
            variants: {
              some: {
                ...(query.compatibility || query.confidence
                  ? {
                      compatibility: {
                        ...(query.compatibility ? { level: query.compatibility } : {}),
                        ...(query.confidence ? { confidence: query.confidence } : {}),
                      },
                    }
                  : {}),
                ...(query.protocol ? { protocols: { some: { protocol: query.protocol } } } : {}),
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { normalizedName: { contains: normalize(search) } },
              { aliasRecords: { some: { normalizedName: { contains: normalize(search) } } } },
              { family: { name: { contains: search } } },
              { brand: { name: { contains: search } } },
              { brand: { manufacturer: { name: { contains: search } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cameraCatalogModel.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
        include: modelInclude,
      }),
      this.prisma.cameraCatalogModel.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async model(id: string) {
    const model = await this.prisma.cameraCatalogModel.findUnique({
      where: { id },
      include: modelInclude,
    });
    if (!model)
      throw new AuthError(404, 'CATALOG_MODEL_NOT_FOUND', 'Camera catalog model not found');
    return model;
  }

  async compatibility(id: string) {
    const model = await this.model(id);
    return {
      modelId: model.id,
      model: model.name,
      variants: model.variants.map((variant) => ({
        id: variant.id,
        hardwareVersion: variant.hardwareVersion,
        region: variant.region,
        compatibility: variant.compatibility,
        protocols: variant.protocols,
        provisioning: variant.provisioningProfiles,
      })),
    };
  }

  createManufacturer(input: { name: string; notes?: string | null | undefined }) {
    return this.prisma.cameraCatalogManufacturer.create({
      data: {
        name: input.name,
        normalizedName: normalize(input.name),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
  }

  async createBrand(input: { manufacturerId: string; name: string }) {
    const manufacturer = await this.prisma.cameraCatalogManufacturer.findUnique({
      where: { id: input.manufacturerId },
      select: { id: true },
    });
    if (!manufacturer)
      throw new AuthError(
        404,
        'CATALOG_MANUFACTURER_NOT_FOUND',
        'Camera catalog manufacturer not found',
      );
    return this.prisma.cameraCatalogBrand.create({
      data: {
        manufacturerId: input.manufacturerId,
        name: input.name,
        normalizedName: normalize(input.name),
      },
    });
  }

  async createFamily(input: { brandId: string; name: string }) {
    const brand = await this.prisma.cameraCatalogBrand.findUnique({
      where: { id: input.brandId },
      select: { id: true },
    });
    if (!brand)
      throw new AuthError(404, 'CATALOG_BRAND_NOT_FOUND', 'Camera catalog brand not found');
    return this.prisma.cameraCatalogFamily.create({
      data: { brandId: input.brandId, name: input.name, normalizedName: normalize(input.name) },
    });
  }

  async createModel(input: {
    brandId: string;
    familyId?: string | null | undefined;
    name: string;
    aliases: string[];
    cameraType: CatalogCameraType;
    resolution?: string | null | undefined;
    hardwareVersion?: string | null | undefined;
    region?: string | null | undefined;
    sku?: string | null | undefined;
    notes?: string | null | undefined;
  }) {
    const brand = await this.prisma.cameraCatalogBrand.findUnique({
      where: { id: input.brandId },
      include: { manufacturer: true },
    });
    if (!brand)
      throw new AuthError(404, 'CATALOG_BRAND_NOT_FOUND', 'Camera catalog brand not found');
    if (input.familyId) {
      const family = await this.prisma.cameraCatalogFamily.findFirst({
        where: { id: input.familyId, brandId: input.brandId },
      });
      if (!family)
        throw new AuthError(400, 'CATALOG_FAMILY_INVALID', 'Family does not belong to brand');
    }
    const normalizedName = normalize(input.name);
    const identityKey = [
      normalize(brand.manufacturer.name),
      normalize(brand.name),
      normalizedName,
      normalize(input.hardwareVersion || 'default'),
      normalize(input.region || 'global'),
    ].join('|');
    return this.prisma.cameraCatalogModel.create({
      data: {
        brandId: input.brandId,
        ...(input.familyId !== undefined ? { familyId: input.familyId } : {}),
        name: input.name,
        normalizedName,
        aliases: input.aliases,
        cameraType: input.cameraType,
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        aliasRecords: {
          create: [...new Set(input.aliases.map((name) => name.trim()))].map((name) => ({
            name,
            normalizedName: normalize(name),
          })),
        },
        variants: {
          create: {
            identityKey,
            ...(input.hardwareVersion !== undefined
              ? { hardwareVersion: input.hardwareVersion }
              : {}),
            ...(input.region !== undefined ? { region: input.region } : {}),
            ...(input.sku !== undefined ? { sku: input.sku } : {}),
            compatibility: {
              create: {
                level: 'UNKNOWN',
                confidence: 'UNVERIFIED',
                reason: 'Aguardando validação técnica.',
              },
            },
          },
        },
      },
      include: modelInclude,
    });
  }

  async updateCompatibility(
    variantId: string,
    input: {
      level: CatalogCompatibilityLevel;
      confidence: CatalogConfidenceLevel;
      reason: string;
      strategy?: string | null | undefined;
    },
  ) {
    const variant = await this.prisma.cameraCatalogVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant)
      throw new AuthError(404, 'CATALOG_VARIANT_NOT_FOUND', 'Camera catalog variant not found');
    const data = {
      level: input.level,
      confidence: input.confidence,
      reason: input.reason,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
    };
    return this.prisma.cameraCatalogCompatibility.upsert({
      where: { variantId },
      update: data,
      create: { variantId, ...data },
    });
  }
}
