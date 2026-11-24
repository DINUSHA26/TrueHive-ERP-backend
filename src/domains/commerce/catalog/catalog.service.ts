import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getProducts(params?: { search?: string; categoryId?: string; status?: string }) {
    const where: any = {};
    if (params?.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { sku: { contains: params.search, mode: "insensitive" } },
        { barcode: { contains: params.search, mode: "insensitive" } },
      ];
    }
    if (params?.categoryId && params.categoryId !== "all") {
      where.categoryId = params.categoryId;
    }
    if (params?.status === "active") {
      where.isActive = true;
    } else if (params?.status === "inactive") {
      where.isActive = false;
    }

    const [products, totalCount, activeCount, lowStockCount] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          variants: true,
          bomItems: { include: { ingredient: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.product.count({ where: { isActive: true, currentStock: { lte: 5 } } }),
    ]);

    return {
      success: true,
      products,
      stats: {
        totalProducts: totalCount,
        activeProducts: activeCount,
        lowStockProducts: lowStockCount,
      },
    };
  }

  async getCategories(params?: { search?: string; status?: string }) {
    const categories = await this.prisma.category.findMany({
      where: {
        parentId: null,
        ...(params?.search
          ? {
              OR: [
                { name: { contains: params.search, mode: "insensitive" } },
                { description: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(params?.status === "active"
          ? { isActive: true }
          : params?.status === "inactive"
          ? { isActive: false }
          : {}),
      },
      include: {
        children: {
          include: { _count: { select: { products: true } } },
          orderBy: { sortOrder: "asc" },
        },
        _count: { select: { products: true } },
      },
      orderBy: { sortOrder: "asc" },
    });

    const [allCount, rootCount, activeCount, productCount] = await Promise.all([
      this.prisma.category.count(),
      this.prisma.category.count({ where: { parentId: null } }),
      this.prisma.category.count({ where: { isActive: true } }),
      this.prisma.product.count(),
    ]);

    const flatCategories = await this.prisma.category.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        isActive: true,
      },
    });

    return {
      success: true,
      categories,
      flatCategories,
      stats: {
        totalCategories: allCount,
        rootCategories: rootCount,
        activeCategories: activeCount,
        totalProducts: productCount,
      },
    };
  }

  async createCategory(data: {
    name: string;
    description?: string;
    image?: string;
    parentId?: string;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    if (!data.name?.trim()) {
      throw new BadRequestException("Category name is required");
    }

    let baseSlug = data.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
    if (!baseSlug) baseSlug = "category";

    let slug = baseSlug;
    let counter = 1;
    while (await this.prisma.category.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const category = await this.prisma.category.create({
      data: {
        name: data.name.trim(),
        slug,
        description: data.description?.trim() || null,
        image: data.image || null,
        parentId: data.parentId || null,
        sortOrder: Number(data.sortOrder || 0),
        isActive: data.isActive !== false,
      },
      include: {
        children: true,
        _count: { select: { products: true } },
      },
    });

    return { success: true, category };
  }

  async updateCategory(
    id: string,
    data: {
      name?: string;
      description?: string;
      image?: string;
      parentId?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    if (!id) throw new BadRequestException("Category ID is required");

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.image !== undefined ? { image: data.image || null } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: Number(data.sortOrder) } : {}),
        ...(data.isActive !== undefined ? { isActive: Boolean(data.isActive) } : {}),
      },
    });

    return { success: true, category };
  }

  async deleteCategory(id: string) {
    if (!id) throw new BadRequestException("Category ID is required");

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new BadRequestException(
        `Cannot delete category: ${productCount} products are assigned to it. Move or delete them first.`
      );
    }

    const category = await this.prisma.category.delete({
      where: { id },
    });

    return { success: true, category };
  }

  async getProductByBarcode(barcode: string) {
    return this.prisma.product.findFirst({
      where: {
        OR: [{ barcode }, { sku: barcode }],
      },
      include: { category: true, variants: true },
    });
  }

  async createProduct(body: any) {
    const {
      name,
      categoryId,
      description,
      sku,
      barcode,
      sellingPrice,
      discountPrice,
      currentStock,
      reorderLevel,
      unit,
      images,
      knowledgeBase,
      variants,
    } = body;

    if (!name?.trim()) throw new BadRequestException("Product name is required");

    const finalBarcode =
      barcode && String(barcode).trim()
        ? String(barcode).trim()
        : `4792026${Math.floor(10000 + Math.random() * 90000)}`;

    const finalSku =
      sku && String(sku).trim()
        ? String(sku).trim().toUpperCase()
        : `TH-PRD-${Math.floor(1000 + Math.random() * 9000)}`;

    let baseSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
    if (!baseSlug) baseSlug = "product";
    let slug = baseSlug;
    let counter = 1;
    while (await this.prisma.product.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const primaryImage = Array.isArray(images) && images.length > 0 ? (images[0]?.url || images[0]) : null;

    const product = await this.prisma.product.create({
      data: {
        name: name.trim(),
        slug,
        sku: finalSku,
        barcode: finalBarcode,
        categoryId: categoryId || null,
        description: description ? String(description).trim() : null,
        imageUrl: primaryImage,
        images: Array.isArray(images) ? images : [],
        sellingPrice: Number(sellingPrice || 0),
        discountPrice: discountPrice ? Number(discountPrice) : null,
        currentStock: Number(currentStock || 0),
        reorderLevel: Number(reorderLevel || 5),
        unit: String(unit || "pcs"),
        knowledgeBase: knowledgeBase || null,
        isActive: true,
      },
      include: {
        category: true,
        variants: true,
      },
    });

    if (Array.isArray(variants) && variants.length > 0) {
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        await this.prisma.productVariant.create({
          data: {
            productId: product.id,
            name: String(v.name || "Variant"),
            value: v.value ? String(v.value) : null,
            sku: v.sku?.trim() || `${finalSku}-V${i + 1}`,
            barcode: v.barcode?.trim() || `${finalBarcode}${i + 1}`,
            sellingPrice: Number(v.sellingPrice ?? product.sellingPrice),
            priceAdjustment: Number(v.priceAdjustment || 0),
            currentStock: Number(v.currentStock || 0),
            image: v.image || null,
          },
        });
      }
    }

    return { success: true, product };
  }

  async updateProduct(id: string, body: any) {
    if (!id) throw new BadRequestException("Product ID is required");

    // Quick stock adjustment
    if (body.newStock !== undefined || body.stockChange !== undefined) {
      const existing = await this.prisma.product.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Product not found");

      let updatedStock = existing.currentStock;
      if (body.newStock !== undefined) {
        updatedStock = Math.max(0, Number(body.newStock));
      } else if (body.stockChange !== undefined) {
        updatedStock = Math.max(0, existing.currentStock + Number(body.stockChange));
      }

      const p = await this.prisma.product.update({
        where: { id },
        data: { currentStock: updatedStock },
        include: { category: true, variants: true },
      });

      return { success: true, product: p };
    }

    const {
      name,
      categoryId,
      description,
      sku,
      barcode,
      sellingPrice,
      discountPrice,
      currentStock,
      reorderLevel,
      unit,
      images,
      knowledgeBase,
      isActive,
    } = body;

    const p = await this.prisma.product.update({
      where: { id },
      data: {
        ...(name ? { name: name.trim() } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(sku ? { sku: sku.trim().toUpperCase() } : {}),
        ...(barcode ? { barcode: barcode.trim() } : {}),
        ...(sellingPrice !== undefined ? { sellingPrice: Number(sellingPrice) } : {}),
        ...(discountPrice !== undefined ? { discountPrice: discountPrice ? Number(discountPrice) : null } : {}),
        ...(currentStock !== undefined ? { currentStock: Math.max(0, Number(currentStock)) } : {}),
        ...(reorderLevel !== undefined ? { reorderLevel: Number(reorderLevel) } : {}),
        ...(unit ? { unit: String(unit) } : {}),
        ...(images ? { images, imageUrl: images[0]?.url || images[0] || null } : {}),
        ...(knowledgeBase !== undefined ? { knowledgeBase } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
      include: { category: true, variants: true },
    });

    return { success: true, product: p };
  }

  async deleteProduct(id: string) {
    if (!id) throw new BadRequestException("Product ID is required");

    const p = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true, product: p };
  }
}
