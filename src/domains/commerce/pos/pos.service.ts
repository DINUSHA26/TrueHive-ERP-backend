import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService } from "@/infrastructure/realtime/realtime.service";
import {
  PaymentMethod,
  PaymentStatus,
  OrderStatus,
  InvoiceStatus,
  InvoiceType,
} from "@prisma/client";

export interface PosCheckoutItem {
  productId: string;
  quantity: number;
  unitOffer?: number;
  offers?: number;
  itemTotal?: number;
}

export interface PosCheckoutDto {
  customerName?: string;
  customerPhone?: string;
  paymentMethod: "CASH" | "CARD" | "QR_PAY" | "ONLINE_BANK" | "CREDIT" | "COD";
  fulfillmentType?: "STORE_PICKUP" | "COURIER_DELIVERY";
  shippingAddress?: string;
  deliveryCity?: string;
  courierPartner?: string;
  items: PosCheckoutItem[];
  subtotal?: number;
  totalDiscount?: number;
  vat?: number;
  serviceCharges?: number;
  deliveryCharges?: number;
  isFreeValue?: boolean;
  grandTotal?: number;
  paidAmount?: number;
  balance?: number;
}

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async checkout(dto: PosCheckoutDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("Cart is empty");
    }

    // 1. Fetch products & verify stock
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    let calculatedSubtotal = 0;
    for (const item of dto.items) {
      const p = productMap.get(item.productId);
      if (!p) {
        throw new BadRequestException(`Product with ID ${item.productId} not found`);
      }
      if (p.currentStock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for "${p.name}". Available: ${p.currentStock}`);
      }
      calculatedSubtotal += p.sellingPrice * item.quantity;
    }

    const subtotal = dto.subtotal ?? calculatedSubtotal;
    const discount = dto.totalDiscount || 0;
    const vat = dto.vat || 0;
    const serviceCharges = dto.serviceCharges || 0;
    const deliveryCharges = dto.deliveryCharges || 0;
    const isFreeValue = Boolean(dto.isFreeValue);

    const calculatedGrand = Math.max(0, subtotal - discount + vat + serviceCharges + deliveryCharges);
    const totalAmount = isFreeValue ? 0 : (dto.grandTotal ?? calculatedGrand);
    const paidAmount = dto.paidAmount ?? (isFreeValue ? 0 : totalAmount);
    const balance = dto.balance ?? Math.max(0, paidAmount - totalAmount);

    const invoiceNumber = `INV-${Math.floor(100000 + Math.random() * 900000)}`;
    const barcode = `BAR-${invoiceNumber}`;

    let prismaPaymentMethod: PaymentMethod = PaymentMethod.CASH;
    if (dto.paymentMethod === "CARD") prismaPaymentMethod = PaymentMethod.CARD;
    else if (dto.paymentMethod === "QR_PAY" || dto.paymentMethod === "ONLINE_BANK") prismaPaymentMethod = PaymentMethod.BANK_TRANSFER;
    else if (dto.paymentMethod === "COD") prismaPaymentMethod = PaymentMethod.COD;
    else if (dto.paymentMethod === "CREDIT") prismaPaymentMethod = PaymentMethod.SPLIT;

    const isCredit = dto.paymentMethod === "CREDIT";
    const isCod = dto.paymentMethod === "COD";
    const isPickup = dto.fulfillmentType !== "COURIER_DELIVERY";
    const isImmediatePaid = !isCredit && !isCod;
    let creditCustomer: any = null;

    if (isCredit) {
      if (!dto.customerPhone || dto.customerPhone.trim() === "" || dto.customerPhone === "POS-Counter") {
        throw new BadRequestException("A valid customer phone number is required for Credit sales.");
      }

      creditCustomer = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { phone: dto.customerPhone.trim() },
            { whatsappId: dto.customerPhone.trim() },
          ],
        },
      });

      if (!creditCustomer) {
        // Auto-register customer with default credit limit
        const custCount = await this.prisma.customer.count();
        const nextCode = `CUST-${String(custCount + 1).padStart(4, "0")}`;
        creditCustomer = await this.prisma.customer.create({
          data: {
            customerCode: nextCode,
            name: dto.customerName || "Credit Customer",
            phone: dto.customerPhone.trim(),
            creditLimit: 50000,
            creditDays: 30,
            creditBalance: 0,
          },
        });
      }

      const availableCredit = creditCustomer.creditLimit - creditCustomer.creditBalance;
      if (creditCustomer.creditLimit > 0 && availableCredit < totalAmount) {
        throw new BadRequestException(
          `Customer credit limit of Rs. ${creditCustomer.creditLimit.toLocaleString()} exceeded! Available credit is Rs. ${Math.max(0, availableCredit).toLocaleString()}. Bill total is Rs. ${totalAmount.toLocaleString()}.`,
        );
      }
    }

    // 2. Execute Atomic Prisma Transaction
    const [order] = await this.prisma.$transaction(async (tx) => {
      // Create Order
      const newOrder = await tx.order.create({
        data: {
          orderNumber: invoiceNumber,
          barcode,
          customerId: creditCustomer ? creditCustomer.id : undefined,
          customerName: dto.customerName || (creditCustomer ? creditCustomer.name : "Walk-in Customer"),
          customerPhone: dto.customerPhone || "POS-Counter",
          shippingAddress: isPickup
            ? "Store Pickup (In-Store Handover)"
            : dto.shippingAddress || "Courier Delivery",
          deliveryCity: isPickup ? "In-Store" : dto.deliveryCity || null,
          courierPartner: isPickup ? "STORE_PICKUP" : dto.courierPartner || "Standard Courier",
          subtotal,
          discountAmount: discount,
          taxAmount: vat,
          deliveryFee: deliveryCharges,
          totalAmount,
          cashReceived: paidAmount,
          changeGiven: balance,
          status: isPickup ? OrderStatus.DELIVERED : OrderStatus.PROCESSING,
          paymentMethod: prismaPaymentMethod,
          paymentStatus: isImmediatePaid ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          source: "POS_TERMINAL",
          notes: JSON.stringify({
            serviceCharges,
            isFreeValue,
            fulfillmentType: dto.fulfillmentType || "STORE_PICKUP",
            exactPaymentMethod: dto.paymentMethod,
            itemsDetail: dto.items,
          }),
          items: {
            create: dto.items.map((i) => {
              const p = productMap.get(i.productId)!;
              const unitOffer = i.unitOffer || 0;
              const itemOffer = i.offers || 0;
              const lineTotal = i.itemTotal ?? Math.max(0, (p.sellingPrice * i.quantity) - (unitOffer * i.quantity) - itemOffer);
              return {
                productId: p.id,
                productName: p.name,
                sku: p.sku,
                barcode: p.barcode,
                quantity: i.quantity,
                unitPrice: p.sellingPrice,
                discount: (unitOffer * i.quantity) + itemOffer,
                totalPrice: lineTotal,
              };
            }),
          },
        },
        include: { items: true },
      });

      // Synchronize with Central Invoice Ledger
      const invoiceStatus = isImmediatePaid ? InvoiceStatus.PAID : isCredit ? InvoiceStatus.UNPAID : InvoiceStatus.ISSUED;
      await tx.invoice.create({
        data: {
          invoiceNumber,
          orderId: newOrder.id,
          customerId: creditCustomer ? creditCustomer.id : undefined,
          customerName: newOrder.customerName,
          customerPhone: newOrder.customerPhone,
          billingAddress: newOrder.shippingAddress || "In-Store POS Counter",
          currency: "LKR",
          subtotal,
          discountAmount: discount,
          taxAmount: vat,
          deliveryFee: deliveryCharges,
          totalAmount,
          paidAmount: isImmediatePaid ? totalAmount : paidAmount,
          creditBilled: isCredit ? totalAmount : 0,
          balance: isImmediatePaid ? 0 : Math.max(0, totalAmount - paidAmount),
          status: invoiceStatus,
          type: InvoiceType.STANDARD,
          paymentMethod: dto.paymentMethod,
          paymentStatus: isImmediatePaid ? "PAID" : "UNPAID",
          notes: `POS Counter Bill #${invoiceNumber}`,
          items: {
            create: dto.items.map((i) => {
              const p = productMap.get(i.productId)!;
              const unitOffer = i.unitOffer || 0;
              const itemOffer = i.offers || 0;
              const lineTotal = i.itemTotal ?? Math.max(0, (p.sellingPrice * i.quantity) - (unitOffer * i.quantity) - itemOffer);
              return {
                productId: p.id,
                sku: p.sku,
                description: p.name,
                unit: p.unit || "pcs",
                quantity: i.quantity,
                unitPrice: p.sellingPrice,
                discount: (unitOffer * i.quantity) + itemOffer,
                totalPrice: lineTotal,
              };
            }),
          },
        },
      });

      // Atomic stock decrements
      for (const item of dto.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { currentStock: { decrement: item.quantity } },
        });
      }

      // If Credit Sale, record Customer Credit Bill and increment customer credit balance
      if (isCredit && creditCustomer) {
        const creditDays = creditCustomer.creditDays || 30;
        const dueDate = new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);

        await tx.customerCreditBill.create({
          data: {
            billNumber: invoiceNumber,
            customerId: creditCustomer.id,
            customerName: creditCustomer.name,
            orderId: newOrder.id,
            creditType: "Credit",
            totalAmount: totalAmount,
            paidAmount: 0,
            balance: totalAmount,
            dueDate: dueDate,
            status: "PENDING",
            notes: `POS Credit Sale Invoice #${invoiceNumber}`,
          },
        });

        await tx.customer.update({
          where: { id: creditCustomer.id },
          data: {
            creditBalance: { increment: totalAmount },
            totalOrders: { increment: 1 },
            totalSpent: { increment: totalAmount },
          },
        });
      }

      // Record CashFlow Transaction
      await tx.cashFlowTransaction.create({
        data: {
          transactionCode: `TX-${invoiceNumber}`,
          amount: totalAmount,
          type: "INCOME",
          category: isCredit ? "POS_CREDIT_SALE" : "POS_SALE",
          description: `POS Invoice #${invoiceNumber}${isFreeValue ? " (Free Value Bill)" : isCredit ? " (Credit Sale)" : ""}`,
          paymentMethod: dto.paymentMethod,
          referenceOrderId: newOrder.id,
        },
      });

      return [newOrder];
    });

    // 3. Realtime Broadcast Stock Deductions to other POS registers & Dashboard
    await this.realtime.broadcastStock("stock-deducted", {
      orderNumber: invoiceNumber,
      items: dto.items,
    });

    return {
      success: true,
      order,
      orderNumber: invoiceNumber,
      totalAmount,
      subtotal,
      discount,
      vat,
      serviceCharges,
      deliveryCharges,
      paidAmount,
      balance,
      isFreeValue,
      paymentMethod: dto.paymentMethod,
      items: order.items,
      timestamp: new Date().toISOString(),
    };
  }
}
