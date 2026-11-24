import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService } from "@/infrastructure/realtime/realtime.service";
import { RedisService } from "@/infrastructure/redis/redis.service";

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
  ) {}

  async getInventoryData() {
    const [products, ingredients, suppliers, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true },
        include: {
          category: true,
          variants: true,
          bomItems: {
            include: {
              ingredient: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.ingredient.findMany({
        where: { isActive: true },
        include: {
          supplier: true,
        },
        orderBy: { currentStock: "asc" },
      }),
      this.prisma.supplier.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.category.findMany({
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      success: true,
      products,
      ingredients,
      suppliers,
      categories,
    };
  }

  async handleAction(body: any) {
    if (!body || !body.action) {
      throw new BadRequestException("Inventory action is required");
    }

    // 1. CREATE PRODUCT
    if (body.action === "CREATE_PRODUCT") {
      const barcode = body.barcode || `4792026${Math.floor(10000 + Math.random() * 90000)}`;
      const sku = body.sku || `TH-PRD-${Math.floor(100 + Math.random() * 900)}`;
      const slug =
        (body.name || "prod")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "") + `-${Date.now().toString().slice(-4)}`;

      const bomItemsInput: { ingredientId: string; quantityRequired: number }[] = Array.isArray(body.bom)
        ? body.bom
        : [];

      let calculatedCogs = Number(body.calculatedCogs || 0);
      if (bomItemsInput.length > 0) {
        const ingIds = bomItemsInput.map((b) => b.ingredientId);
        const ings = await this.prisma.ingredient.findMany({
          where: { id: { in: ingIds } },
        });
        calculatedCogs = bomItemsInput.reduce((acc, b) => {
          const match = ings.find((i) => i.id === b.ingredientId);
          return acc + (match ? match.unitCost * b.quantityRequired : 0);
        }, 0);
      }

      const product = await this.prisma.product.create({
        data: {
          name: String(body.name),
          slug,
          sku,
          barcode,
          sellingPrice: Number(body.sellingPrice || 0),
          calculatedCogs: Math.round(calculatedCogs),
          currentStock: Number(body.currentStock || 0),
          reorderLevel: Number(body.reorderLevel || 5),
          unit: String(body.unit || "pcs"),
          trackBom: Boolean(body.trackBom ?? true),
          categoryId: body.categoryId || undefined,
          bomItems: {
            create: bomItemsInput.map((b) => ({
              ingredientId: b.ingredientId,
              quantityRequired: Number(b.quantityRequired || 0.1),
            })),
          },
        },
        include: {
          bomItems: {
            include: { ingredient: true },
          },
          category: true,
        },
      });

      await this.redis.setLiveStock(product.sku, product.currentStock);
      await this.realtime.broadcastStock("product-created", { product });

      return { success: true, product };
    }

    // 2. CREATE INGREDIENT
    if (body.action === "CREATE_INGREDIENT") {
      const barcode = body.barcode || `890100${Math.floor(1000 + Math.random() * 9000)}`;
      const sku = body.sku || `ING-${Date.now().toString().slice(-4)}`;

      let supplierId = body.supplierId;
      if (!supplierId && body.supplierName) {
        let sup = await this.prisma.supplier.findFirst({
          where: { name: body.supplierName },
        });
        if (!sup) {
          sup = await this.prisma.supplier.create({
            data: {
              name: body.supplierName,
              phone: "+94770000000",
            },
          });
        }
        supplierId = sup.id;
      }

      const newIng = await this.prisma.ingredient.create({
        data: {
          name: String(body.name),
          sku,
          barcode,
          unit: String(body.unit || "kg"),
          currentStock: Number(body.currentStock || 0),
          reorderLevel: Number(body.reorderLevel || 10),
          unitCost: Number(body.unitCost || 0),
          supplierId: supplierId || undefined,
        },
        include: { supplier: true },
      });

      return { success: true, ingredient: newIng };
    }

    // 3. UPDATE INGREDIENT
    if (body.action === "UPDATE_INGREDIENT") {
      const ingId = body.id || body.ingredientId;
      if (!ingId) throw new BadRequestException("Ingredient ID is required");

      let supplierId = body.supplierId;
      if (!supplierId && body.supplierName) {
        let sup = await this.prisma.supplier.findFirst({
          where: { name: body.supplierName },
        });
        if (!sup) {
          sup = await this.prisma.supplier.create({
            data: {
              name: body.supplierName,
              phone: "+94770000000",
            },
          });
        }
        supplierId = sup.id;
      }

      const updated = await this.prisma.ingredient.update({
        where: { id: ingId },
        data: {
          name: body.name ? String(body.name).trim() : undefined,
          sku: body.sku ? String(body.sku).trim() : undefined,
          barcode: body.barcode ? String(body.barcode).trim() : undefined,
          unit: body.unit ? String(body.unit) : undefined,
          unitCost: body.unitCost !== undefined ? Number(body.unitCost) : undefined,
          currentStock: body.currentStock !== undefined ? Number(body.currentStock) : undefined,
          reorderLevel: body.reorderLevel !== undefined ? Number(body.reorderLevel) : undefined,
          supplierId: supplierId !== undefined ? supplierId : undefined,
        },
        include: { supplier: true },
      });

      return { success: true, ingredient: updated };
    }

    // 4. DELETE INGREDIENT
    if (body.action === "DELETE_INGREDIENT") {
      const ingId = body.id || body.ingredientId;
      if (!ingId) throw new BadRequestException("Ingredient ID is required");

      const updated = await this.prisma.ingredient.update({
        where: { id: ingId },
        data: { isActive: false },
      });

      return { success: true, ingredient: updated };
    }

    // 5. RESTOCK INGREDIENT (GRN)
    if (body.action === "RESTOCK_INGREDIENT") {
      const ingId = body.ingredientId;
      const qty = Number(body.quantity || 0);

      const updated = await this.prisma.ingredient.update({
        where: { id: ingId },
        data: {
          currentStock: { increment: qty },
          unitCost: body.unitCost ? Number(body.unitCost) : undefined,
        },
      });

      await this.prisma.stockMovement.create({
        data: {
          ingredientId: updated.id,
          type: "PURCHASE_GRN",
          quantityChange: qty,
          balanceAfter: updated.currentStock,
          unitCost: updated.unitCost,
          notes: body.notes || "Manual GRN Restock",
        },
      });

      return { success: true, ingredient: updated };
    }

    // 6. RECORD WASTAGE
    if (body.action === "RECORD_WASTAGE") {
      const ingId = body.ingredientId;
      const qty = Number(body.quantity || 0);

      const ing = await this.prisma.ingredient.findUnique({ where: { id: ingId } });
      if (!ing) throw new NotFoundException("Ingredient not found");

      const updated = await this.prisma.ingredient.update({
        where: { id: ingId },
        data: {
          currentStock: { decrement: qty },
        },
      });

      const wastageCost = qty * ing.unitCost;

      await this.prisma.stockMovement.create({
        data: {
          ingredientId: ing.id,
          type: "WASTAGE",
          quantityChange: -qty,
          balanceAfter: updated.currentStock,
          unitCost: ing.unitCost,
          notes: body.reason || "Ingredient wastage recorded",
        },
      });

      await this.prisma.cashFlowTransaction.create({
        data: {
          transactionCode: `TXN-WST-${Date.now().toString().slice(-6)}`,
          type: "EXPENSE",
          category: "INGREDIENT_WASTAGE",
          amount: wastageCost,
          description: `Wastage logged: ${ing.name} (-${qty} ${ing.unit}) - ${body.reason || "Kitchen spillage"}`,
          paymentMethod: "SYSTEM_LEDGER",
        },
      });

      return { success: true, ingredient: updated, wastageCost };
    }

    // 7. ADD BOM ITEM
    if (body.action === "ADD_BOM_ITEM") {
      const { productId, ingredientId, quantityRequired } = body;

      const bomItem = await this.prisma.productIngredientBOM.upsert({
        where: {
          productId_ingredientId: {
            productId,
            ingredientId,
          },
        },
        update: {
          quantityRequired: Number(quantityRequired),
        },
        create: {
          productId,
          ingredientId,
          quantityRequired: Number(quantityRequired),
        },
        include: {
          ingredient: true,
        },
      });

      return { success: true, bomItem };
    }

    throw new BadRequestException(`Unknown inventory action: ${body.action}`);
  }
}
