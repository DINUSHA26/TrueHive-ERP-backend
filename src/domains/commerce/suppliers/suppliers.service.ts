import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { StockMovementType } from "@prisma/client";

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSuppliersData() {
    const [suppliers, purchaseOrders, ingredients, products] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { isActive: true },
        include: {
          ingredients: true,
          purchaseOrders: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.purchaseOrder.findMany({
        include: {
          supplier: true,
          items: {
            include: { ingredient: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.ingredient.findMany({
        where: { isActive: true },
        select: { id: true, name: true, unit: true, unitCost: true, currentStock: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true, sku: true, barcode: true, unit: true, calculatedCogs: true, sellingPrice: true, currentStock: true },
        orderBy: { name: "asc" },
      }),
    ]);

    // Format purchase orders with flat convenience fields for UI
    const formattedPos = purchaseOrders.map((po) => {
      let meta: any = {};
      try {
        if (po.notes && po.notes.startsWith("{")) {
          meta = JSON.parse(po.notes);
        }
      } catch {}

      const firstItem = po.items[0];
      const unit = meta.unit || firstItem?.ingredient?.unit || "pcs";
      const itemType = meta.itemType || (firstItem?.ingredientId ? "INGREDIENT" : "PRODUCT");

      return {
        id: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        supplierName: po.supplier?.name || "Unknown Supplier",
        itemName: firstItem?.itemName || "Procurement Item",
        quantityOrdered: firstItem?.quantityOrdered || 0,
        quantityReceived: firstItem?.quantityReceived || 0,
        unit,
        itemType,
        unitCost: firstItem?.unitCost || 0,
        totalCost: firstItem?.totalCost || po.totalAmount,
        status: po.status,
        expectedDate: po.expectedDate,
        receivedAt: po.receivedAt,
        notes: po.notes,
        rawItems: po.items,
        createdAt: po.createdAt.toISOString(),
      };
    });

    return {
      success: true,
      suppliers,
      purchaseOrders: formattedPos,
      ingredients,
      products,
    };
  }

  async createSupplier(data: any) {
    const count = await this.prisma.supplier.count();
    const supplierCode = data.supplierCode || `SUPP-${String(count + 1).padStart(4, "0")}`;

    return this.prisma.supplier.create({
      data: {
        supplierCode,
        name: data.name,
        contactPerson: data.contactPerson || "Manager",
        phone: data.phone,
        email: data.email || null,
        address: data.address || null,
        creditLimit: Number(data.creditLimit) || 100000,
        creditDays: Number(data.creditDays) || 30,
        description: data.description || null,
        isActive: true,
      },
    });
  }

  async updateSupplier(id: string, data: any) {
    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.contactPerson !== undefined && { contactPerson: data.contactPerson }),
        ...(data.phone && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.creditLimit !== undefined && { creditLimit: Number(data.creditLimit) }),
        ...(data.creditDays !== undefined && { creditDays: Number(data.creditDays) }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
  }

  async deleteSupplier(id: string) {
    await this.prisma.ingredient.updateMany({
      where: { supplierId: id },
      data: { supplierId: null },
    });
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async createPurchaseOrder(data: any) {
    const poNumber = `PO-${Math.floor(10000 + Math.random() * 90000)}`;
    const quantity = Number(data.quantity) || 1;
    const unitCost = Number(data.unitCost) || 0;
    const totalCost = quantity * unitCost;

    const itemType = data.itemType === "PRODUCT" ? "PRODUCT" : "INGREDIENT";
    const unit = data.unit || (itemType === "PRODUCT" ? "pcs" : "kg");

    let finalItemName = data.itemName || "Procurement Item";
    let ingredientId: string | null = null;
    let productId: string | null = null;

    if (itemType === "PRODUCT") {
      if (data.itemId || data.productId) {
        productId = data.itemId || data.productId;
        const prod = await this.prisma.product.findUnique({ where: { id: productId! } });
        if (prod) finalItemName = prod.name;
      }
    } else {
      if (data.itemId || data.ingredientId) {
        ingredientId = data.itemId || data.ingredientId;
        const ing = await this.prisma.ingredient.findUnique({ where: { id: ingredientId! } });
        if (ing) finalItemName = ing.name;
      }
    }

    const meta = {
      itemType,
      unit,
      itemId: productId || ingredientId,
      expectedDate: data.expectedDate || null,
      notes: data.notes || null,
    };

    const displayItemName = `[${itemType === "PRODUCT" ? "Product" : "Ingredient"}] ${finalItemName} (${unit})`;

    const po = await this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: data.supplierId,
        totalAmount: totalCost,
        status: "ISSUED",
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        notes: JSON.stringify(meta),
        items: {
          create: [
            {
              ingredientId: ingredientId || undefined,
              itemName: displayItemName,
              quantityOrdered: quantity,
              unitCost: unitCost,
              totalCost,
            },
          ],
        },
      },
      include: {
        supplier: true,
        items: { include: { ingredient: true } },
      },
    });

    // Also mirror into Invoice table
    try {
      await this.prisma.invoice.create({
        data: {
          invoiceNumber: poNumber,
          type: "STANDARD",
          status: "DRAFT",
          customerName: `${po.supplier?.name || "Supplier"} (Supplier)`,
          customerPhone: po.supplier?.phone || null,
          billingAddress: po.supplier?.address || "Supplier Procurement",
          currency: "LKR",
          subtotal: totalCost,
          discountAmount: 0,
          taxAmount: 0,
          deliveryFee: 0,
          totalAmount: totalCost,
          paidAmount: 0,
          creditBilled: totalCost,
          balance: totalCost,
          returnValue: 0,
          paymentMethod: "SUPPLIER_PO",
          paymentStatus: "UNPAID",
          notes: `Purchase Order for ${displayItemName}`,
          items: {
            create: [
              {
                description: displayItemName,
                unit: unit,
                quantity: quantity,
                unitPrice: unitCost,
                totalPrice: totalCost,
              },
            ],
          },
        },
      });
    } catch (e) {
      // Non-blocking mirror
    }

    return po;
  }

  async receiveGrn(poId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { supplier: true, items: true },
    });

    if (!po) throw new Error("Purchase Order not found");

    let meta: any = {};
    try {
      if (po.notes && po.notes.startsWith("{")) {
        meta = JSON.parse(po.notes);
      }
    } catch {}

    const firstItem = po.items[0];
    const quantity = firstItem?.quantityOrdered || 0;
    const unitCost = firstItem?.unitCost || 0;
    const itemType = meta.itemType || (firstItem?.ingredientId ? "INGREDIENT" : "PRODUCT");
    const unit = meta.unit || "pcs";
    const itemId = meta.itemId || firstItem?.ingredientId;

    // 1. Update Inventory Stock & Movement
    if (itemType === "PRODUCT" && itemId) {
      const prod = await this.prisma.product.findUnique({ where: { id: itemId } });
      if (prod) {
        await this.prisma.product.update({
          where: { id: itemId },
          data: { currentStock: { increment: quantity } },
        });

        await this.prisma.stockMovement.create({
          data: {
            productId: itemId,
            type: StockMovementType.PURCHASE_GRN,
            quantityChange: quantity,
            balanceAfter: prod.currentStock + quantity,
            unitCost,
            referenceId: po.poNumber,
            notes: `GRN Intake from ${po.supplier.name} (${quantity} ${unit})`,
          },
        });
      }
    } else if (itemId) {
      const ing = await this.prisma.ingredient.findUnique({ where: { id: itemId } });
      if (ing) {
        await this.prisma.ingredient.update({
          where: { id: itemId },
          data: { currentStock: { increment: quantity } },
        });

        await this.prisma.stockMovement.create({
          data: {
            ingredientId: itemId,
            type: StockMovementType.PURCHASE_GRN,
            quantityChange: quantity,
            balanceAfter: ing.currentStock + quantity,
            unitCost,
            referenceId: po.poNumber,
            notes: `GRN Intake from ${po.supplier.name} (${quantity} ${unit})`,
          },
        });
      }
    }

    // 2. Mark PO as COMPLETED
    const updatedPo = await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: "COMPLETED",
        receivedAt: new Date(),
        items: {
          updateMany: {
            where: { purchaseOrderId: poId },
            data: { quantityReceived: quantity },
          },
        },
      },
    });

    // 3. Update Supplier credit balance
    await this.prisma.supplier.update({
      where: { id: po.supplierId },
      data: { creditBalance: { increment: po.totalAmount } },
    });

    // 4. Create Supplier Bill in Ledger (AP)
    const dueDate = new Date(Date.now() + (po.supplier.creditDays || 30) * 86400000);
    const existingBill = await this.prisma.supplierBill.findUnique({
      where: { billNumber: `BILL-${po.poNumber}` },
    });

    if (!existingBill) {
      await this.prisma.supplierBill.create({
        data: {
          billNumber: `BILL-${po.poNumber}`,
          supplierId: po.supplierId,
          supplierName: po.supplier.name,
          poGrnNumber: po.poNumber,
          invoiceNumber: `INV-${po.poNumber}`,
          creditDays: po.supplier.creditDays || 30,
          dueDate,
          totalAmount: po.totalAmount,
          paidAmount: 0,
          balance: po.totalAmount,
          status: "DUE",
          itemType,
          items: JSON.stringify([{
            name: firstItem?.itemName || "Item",
            quantity,
            unit,
            unitCost,
            totalCost: po.totalAmount,
          }]),
          notes: `Auto-generated from PO #${po.poNumber}`,
        },
      });
    }

    // Also update mirrored Invoice status to UNPAID
    try {
      await this.prisma.invoice.updateMany({
        where: {
          OR: [
            { invoiceNumber: po.poNumber },
            { invoiceNumber: `INV-${po.poNumber}` },
          ],
        },
        data: {
          status: "UNPAID",
          paymentStatus: "UNPAID",
        },
      });
    } catch (e) {
      // non-blocking
    }

    return {
      success: true,
      purchaseOrder: {
        ...updatedPo,
        quantityOrdered: quantity,
        unit,
      },
    };
  }

  async deletePurchaseOrder(poId: string) {
    return this.prisma.purchaseOrder.delete({
      where: { id: poId },
    });
  }

  async paySupplier(supplierId: string, amount: number) {
    const payAmount = Number(amount || 0);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new Error("Supplier not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplierId },
        data: { creditBalance: { decrement: payAmount } },
      });

      await tx.cashFlowTransaction.create({
        data: {
          transactionCode: `TXN-SUP-${Date.now().toString().slice(-6)}`,
          type: "SUPPLIER_PAYMENT",
          category: "SUPPLIER_CREDIT_SETTLEMENT",
          amount: payAmount,
          description: `Settled Supplier Payable to ${supplier.name}`,
          paymentMethod: "BANK_TRANSFER",
        },
      });
    });

    const updated = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    return updated;
  }
}
