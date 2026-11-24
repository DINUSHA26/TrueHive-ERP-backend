import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService } from "@/infrastructure/realtime/realtime.service";
import { OrderStatus, PaymentMethod, PaymentStatus, OrderSource } from "@prisma/client";

export interface CreateOrderDto {
  customerName: string;
  customerPhone: string;
  secondaryPhone?: string;
  deliveryCity?: string;
  shippingAddress?: string;
  source?: "WHATSAPP_AI" | "POS_TERMINAL" | "MANUAL_DASHBOARD";
  paymentMethod?: "COD" | "CASH" | "CARD" | "BANK_TRANSFER" | "CREDIT";
  courierPartner?: string;
  trackingNumber?: string;
  expectedDeliveryDate?: string;
  deliveryFee?: number;
  discountAmount?: number;
  notes?: string;
  items: {
    productId: string;
    quantity: number;
    unitPrice?: number;
    discount?: number;
  }[];
}

export interface UpdateOrderStatusDto {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  note?: string;
  updatedBy?: string;
}

export interface UpdateShipmentDto {
  courierPartner: string;
  trackingNumber: string;
  expectedDeliveryDate?: string;
  deliveryCity?: string;
  secondaryPhone?: string;
  notes?: string;
}

export interface SettleCodDto {
  collectedAmount: number;
  courierFee?: number;
  remittanceRef?: string;
  notes?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Get all orders with full details & dashboard KPI statistics
   */
  async getOrdersData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [orders, allCount, todayCod, monthCod] = await Promise.all([
      this.prisma.order.findMany({
        include: {
          items: {
            include: { product: true },
          },
          customer: true,
          statusHistory: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          paymentMethod: PaymentMethod.COD,
          createdAt: { gte: today },
        },
      }),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          paymentMethod: PaymentMethod.COD,
          createdAt: { gte: monthStart },
        },
      }),
    ]);

    // Compute live dashboard metrics
    let totalOrderValue = 0;
    let totalCollected = 0;
    let totalUnpaid = 0;
    let todayCodCollected = 0;
    let totalOutstandingCod = 0;

    orders.forEach((o) => {
      totalOrderValue += o.totalAmount;

      if (o.paymentStatus === PaymentStatus.PAID) {
        totalCollected += o.totalAmount;
      } else if (o.paymentStatus === PaymentStatus.PARTIAL) {
        totalCollected += o.cashReceived || 0;
        totalUnpaid += Math.max(0, o.totalAmount - (o.cashReceived || 0));
      } else {
        totalUnpaid += o.totalAmount;
      }

      if (o.paymentMethod === PaymentMethod.COD) {
        if (o.settlementStatus === "SETTLED" || o.paymentStatus === PaymentStatus.PAID) {
          if (o.remittedAt && new Date(o.remittedAt) >= today) {
            todayCodCollected += o.remittedAmount || o.totalAmount;
          }
        } else {
          totalOutstandingCod += o.codAmount || o.totalAmount;
        }
      }
    });

    return {
      success: true,
      stats: {
        totalOrders: allCount,
        totalOrderValue,
        totalCollected,
        totalUnpaid,
        todayCodOrders: todayCod._sum.totalAmount || 0,
        todayCodCollected,
        thisMonthCod: monthCod._sum.totalAmount || 0,
        totalOutstandingCod,
      },
      orders,
    };
  }

  async getOrderById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        customer: true,
        statusHistory: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    return order;
  }

  /**
   * Create Manual or COD Order from Dashboard / WhatsApp
   */
  async createOrder(dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("At least one product item is required");
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    let calculatedSubtotal = 0;
    for (const item of dto.items) {
      const p = productMap.get(item.productId);
      if (!p) throw new NotFoundException(`Product not found: ${item.productId}`);
      if (p.currentStock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for "${p.name}". Available: ${p.currentStock}`);
      }
      calculatedSubtotal += (item.unitPrice ?? p.sellingPrice) * item.quantity;
    }

    const deliveryFee = dto.deliveryFee || 0;
    const discountAmount = dto.discountAmount || 0;
    const totalAmount = Math.max(0, calculatedSubtotal - discountAmount + deliveryFee);

    const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
    const barcode = `BAR-${orderNumber}`;

    // Customer lookup or auto-creation
    let customer = await this.prisma.customer.findFirst({
      where: {
        OR: [{ phone: dto.customerPhone.trim() }, { whatsappId: dto.customerPhone.trim() }],
      },
    });

    if (!customer) {
      const custCount = await this.prisma.customer.count();
      customer = await this.prisma.customer.create({
        data: {
          customerCode: `CUST-${String(custCount + 1).padStart(4, "0")}`,
          name: dto.customerName.trim(),
          phone: dto.customerPhone.trim(),
          address: dto.shippingAddress || dto.deliveryCity || null,
          city: dto.deliveryCity || null,
          creditLimit: 50000,
          creditDays: 30,
        },
      });
    }

    let prismaPaymentMethod: PaymentMethod = PaymentMethod.COD;
    if (dto.paymentMethod === "CASH") prismaPaymentMethod = PaymentMethod.CASH;
    else if (dto.paymentMethod === "CARD") prismaPaymentMethod = PaymentMethod.CARD;
    else if (dto.paymentMethod === "BANK_TRANSFER") prismaPaymentMethod = PaymentMethod.BANK_TRANSFER;
    else if (dto.paymentMethod === "CREDIT") prismaPaymentMethod = PaymentMethod.SPLIT;

    const isCod = prismaPaymentMethod === PaymentMethod.COD;
    const isCredit = prismaPaymentMethod === PaymentMethod.SPLIT;
    const isImmediatePaid = !isCod && !isCredit;
    const isPickup =
      dto.courierPartner === "STORE_PICKUP" ||
      dto.shippingAddress?.toLowerCase().includes("store pickup") ||
      dto.shippingAddress?.toLowerCase().includes("pickup");

    // Execute atomic transaction
    const [newOrder] = await this.prisma.$transaction(async (tx) => {
      // 1. Create Order
      const ord = await tx.order.create({
        data: {
          orderNumber,
          barcode,
          customerId: customer.id,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          secondaryPhone: dto.secondaryPhone?.trim() || null,
          deliveryCity: dto.deliveryCity?.trim() || null,
          shippingAddress: dto.shippingAddress?.trim() || (isPickup ? "Store Pickup (In-Store Handover)" : null),
          source: (dto.source as OrderSource) || OrderSource.MANUAL_DASHBOARD,
          status: isPickup ? OrderStatus.DELIVERED : OrderStatus.CONFIRMED,
          paymentMethod: prismaPaymentMethod,
          paymentStatus: isImmediatePaid ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          subtotal: calculatedSubtotal,
          discountAmount,
          deliveryFee,
          totalAmount,
          courierPartner: isPickup ? "STORE_PICKUP" : (dto.courierPartner || null),
          trackingNumber: dto.trackingNumber || null,
          expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
          codAmount: isCod ? totalAmount : null,
          settlementStatus: isCod ? "PENDING" : "NOT_DUE",
          notes: dto.notes || null,
          items: {
            create: dto.items.map((it) => {
              const p = productMap.get(it.productId)!;
              const unitPrice = it.unitPrice ?? p.sellingPrice;
              const lineTotal = unitPrice * it.quantity;
              return {
                productId: p.id,
                productName: p.name,
                sku: p.sku,
                barcode: p.barcode,
                quantity: it.quantity,
                unitPrice,
                unitCogs: p.calculatedCogs || 0,
                discount: it.discount || 0,
                totalPrice: lineTotal,
              };
            }),
          },
        },
        include: { items: true, customer: true },
      });

      // 2. Decrement product stock
      for (const it of dto.items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { currentStock: { decrement: it.quantity } },
        });
      }

      // 3. If Credit, create linked CustomerCreditBill
      if (isCredit) {
        const creditDays = customer.creditDays || 30;
        const dueDate = new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);
        await tx.customerCreditBill.create({
          data: {
            billNumber: orderNumber,
            customerId: customer.id,
            customerName: customer.name,
            orderId: ord.id,
            creditType: "Credit",
            totalAmount,
            paidAmount: 0,
            balance: totalAmount,
            dueDate,
            status: "PENDING",
            notes: `Credit Order #${orderNumber}`,
          },
        });

        await tx.customer.update({
          where: { id: customer.id },
          data: {
            creditBalance: { increment: totalAmount },
            totalOrders: { increment: 1 },
            totalSpent: { increment: totalAmount },
          },
        });
      }

      // 4. Record Status History
      await tx.orderStatusHistory.create({
        data: {
          orderId: ord.id,
          status: OrderStatus.CONFIRMED,
          note: `Order registered via ${dto.source || "Dashboard"}.`,
          updatedBy: "System",
        },
      });

      return [ord];
    });

    // Realtime broadcast
    await this.realtime.broadcastStock("stock-deducted", {
      orderNumber,
      items: dto.items,
    });

    // Notify Admin (0765731249) on WhatsApp whenever an order is placed
    this.notifyAdminOnNewOrder(newOrder).catch((e) =>
      this.logger.warn(`Admin order WhatsApp alert skipped: ${e.message}`)
    );

    return {
      success: true,
      order: newOrder,
    };
  }

  private async notifyAdminOnNewOrder(order: any): Promise<void> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const apiVersion = process.env.WHATSAPP_API_VERSION || "v21.0";
    if (!token || !phoneId || !order) return;

    const rawAdmin = process.env.WHATSAPP_ADMIN_PHONE || "0765731249";
    const digits = rawAdmin.replace(/\D/g, "");
    const adminPhone =
      digits.startsWith("0") && digits.length === 10 ? `94${digits.slice(1)}` : digits;

    const itemSummary = Array.isArray(order.items)
      ? order.items.map((i: any) => `${i.productName} (x${i.quantity})`).join(", ")
      : "Items";

    const alertText = `🎉 *[TrueHive New Order Placed]*\nOrder #: ${order.orderNumber}\nCustomer: ${order.customerName} (${order.customerPhone})\nItems: ${itemSummary}\nTotal: Rs. ${Number(order.totalAmount || 0).toLocaleString()} (${order.paymentMethod})\nAddress: ${order.shippingAddress || "N/A"}\n👉 Check CRM Order Management:\nhttps://main.d37dp08oxfbpii.amplifyapp.com/orders`;

    const url = `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`;
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: adminPhone,
        type: "text",
        text: { body: alertText },
      }),
    });
  }

  /**
   * Update Order Status (Fulfillment lifecycle)
   */
  async updateOrderStatus(id: string, dto: UpdateOrderStatusDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });

    if (!existing) {
      throw new NotFoundException("Order not found");
    }

    const oldStatus = existing.status;
    const newStatus = dto.status;

    return this.prisma.$transaction(async (tx) => {
      // If moving to CANCELLED from non-cancelled, restore stock
      if (newStatus === OrderStatus.CANCELLED && oldStatus !== OrderStatus.CANCELLED) {
        for (const item of existing.items) {
          if (item.productId) {
            try {
              await tx.product.update({
                where: { id: item.productId },
                data: { currentStock: { increment: item.quantity } },
              });
            } catch {}
          }
        }
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          ...(newStatus ? { status: newStatus } : {}),
          ...(dto.paymentStatus ? { paymentStatus: dto.paymentStatus } : {}),
          ...(newStatus === OrderStatus.DELIVERED && existing.paymentMethod === PaymentMethod.COD
            ? { settlementStatus: "AWAITING_REMITTANCE" }
            : {}),
        },
        include: { items: true, customer: true, statusHistory: true },
      });

      // Record in history
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: newStatus || existing.status,
          note: dto.note || `Status transitioned from ${oldStatus} to ${newStatus || existing.status}`,
          updatedBy: dto.updatedBy || "Staff",
        },
      });

      return {
        success: true,
        order: updated,
        whatsappMessageSent: `Order #${existing.orderNumber} status is now ${newStatus}.`,
      };
    });
  }

  /**
   * Update Shipment / Waybill Information
   */
  async updateShipment(id: string, dto: UpdateShipmentDto) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Order not found");

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        courierPartner: dto.courierPartner,
        trackingNumber: dto.trackingNumber,
        expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
        deliveryCity: dto.deliveryCity || undefined,
        secondaryPhone: dto.secondaryPhone || undefined,
        status: existing.status === OrderStatus.PENDING || existing.status === OrderStatus.CONFIRMED || existing.status === OrderStatus.PROCESSING
          ? OrderStatus.READY_TO_SHIP
          : existing.status,
      },
      include: { items: true, customer: true },
    });

    await this.prisma.orderStatusHistory.create({
      data: {
        orderId: id,
        status: updated.status,
        note: `Waybill assigned: ${dto.courierPartner} (${dto.trackingNumber})`,
        updatedBy: "Logistics",
      },
    });

    return {
      success: true,
      order: updated,
    };
  }

  /**
   * Settle COD Order (Courier Remittance & Reconciliation)
   */
  async settleCod(id: string, dto: SettleCodDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");

    const collected = Number(dto.collectedAmount) || order.totalAmount;
    const fee = Number(dto.courierFee) || 0;
    const netRemitted = Math.max(0, collected - fee);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          settlementStatus: "SETTLED",
          courierFee: fee,
          remittedAmount: netRemitted,
          remittanceRef: dto.remittanceRef || `REMIT-${Date.now().toString().slice(-6)}`,
          remittedAt: new Date(),
        },
        include: { items: true, customer: true },
      });

      // Record CashFlow income for net remitted
      await tx.cashFlowTransaction.create({
        data: {
          transactionCode: `COD-${order.orderNumber}`,
          amount: netRemitted,
          type: "INCOME",
          category: "COD_REMITTANCE",
          description: `COD Settlement: Order #${order.orderNumber} via ${order.courierPartner || "Courier"} (Net: Rs. ${netRemitted}, Courier Fee: Rs. ${fee})`,
          paymentMethod: "BANK_TRANSFER",
          referenceOrderId: order.id,
        },
      });

      // Record history
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: updated.status,
          note: `COD Remittance Settled: Rs. ${netRemitted} received after Rs. ${fee} courier fee.`,
          updatedBy: "Finance",
        },
      });

      return {
        success: true,
        order: updated,
        netRemitted,
        courierFee: fee,
      };
    });
  }

  /**
   * Verify Bank Slip Payment
   */
  async verifyPayment(id: string, dto: { notes?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          status: order.status === OrderStatus.PENDING ? OrderStatus.CONFIRMED : order.status,
        },
        include: { items: true, customer: true },
      });

      await tx.cashFlowTransaction.create({
        data: {
          transactionCode: `VERIFY-${order.orderNumber}`,
          amount: order.totalAmount,
          type: "INCOME",
          category: "BANK_TRANSFER_VERIFIED",
          description: `Bank Transfer Verified for Order #${order.orderNumber}`,
          paymentMethod: "BANK_TRANSFER",
          referenceOrderId: order.id,
        },
      });

      return {
        success: true,
        order: updated,
      };
    });
  }

  /**
   * Update Payment Status (e.g. mark CASH/CARD/BANK as PAID)
   */
  async updatePaymentStatus(id: string, paymentStatus: PaymentStatus | string) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Order not found");

    const validatedStatus =
      paymentStatus === "PAID"
        ? PaymentStatus.PAID
        : paymentStatus === "PARTIAL"
        ? PaymentStatus.PARTIAL
        : PaymentStatus.UNPAID;

    const updated = await this.prisma.order.update({
      where: { id },
      data: { paymentStatus: validatedStatus },
    });

    // Also synchronize corresponding invoice
    await this.prisma.invoice.updateMany({
      where: { orderId: id },
      data: {
        paymentStatus: validatedStatus === PaymentStatus.PAID ? "PAID" : "UNPAID",
        status: validatedStatus === PaymentStatus.PAID ? "PAID" : "UNPAID",
      },
    }).catch(() => null);

    return { success: true, order: updated };
  }

  /**
   * Delete / Cancel Order and Restore Stock
   */
  async deleteOrder(id: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException("Order not found");
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Restore product stock
      for (const item of existing.items) {
        if (item.productId) {
          try {
            await tx.product.update({
              where: { id: item.productId },
              data: { currentStock: { increment: item.quantity } },
            });
          } catch {}
        }
      }

      // 2. Delete linked transactions
      await tx.cashFlowTransaction.deleteMany({
        where: { referenceOrderId: id },
      });

      // 3. Delete order items
      await tx.orderItem.deleteMany({
        where: { orderId: id },
      });

      // 4. Delete linked credit bills if any
      await tx.customerCreditBill.deleteMany({
        where: { orderId: id },
      });

      // 5. Delete order
      await tx.order.delete({
        where: { id },
      });

      return { success: true, message: `Order ${existing.orderNumber} deleted successfully` };
    });
  }
}
