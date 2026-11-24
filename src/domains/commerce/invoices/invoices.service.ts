import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService, CHANNELS } from "@/infrastructure/realtime/realtime.service";
import { CreateInvoiceDto, RecordInvoicePaymentDto, VoidInvoiceDto } from "./dto/create-invoice.dto";
import { InvoiceStatus, InvoiceType } from "@prisma/client";

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Generate sequential Invoice Number (e.g. INV-858000)
   */
  async generateNextInvoiceNumber(): Promise<string> {
    const lastInvoice = await this.prisma.invoice.findFirst({
      orderBy: { createdAt: "desc" },
      select: { invoiceNumber: true },
    });

    if (!lastInvoice || !lastInvoice.invoiceNumber) {
      return "INV-858000";
    }

    const match = lastInvoice.invoiceNumber.match(/INV-(\d+)/i);
    if (match) {
      const nextNum = parseInt(match[1], 10) + 1;
      return `INV-${nextNum}`;
    }

    return `INV-${Math.floor(100000 + Math.random() * 900000)}`;
  }

  /**
   * List all invoices with comprehensive filters (Search, Date, Month, Range)
   */
  async getInvoices(filters?: {
    search?: string;
    date?: string;
    month?: string;
    fromDate?: string;
    toDate?: string;
    status?: string;
  }) {
    const where: any = {};

    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { paymentMethod: { contains: q, mode: "insensitive" } },
      ];
    }

    if (filters?.status && filters.status !== "ALL") {
      where.status = filters.status as InvoiceStatus;
    }

    // Specific single date filter (e.g. "2026-11-19")
    if (filters?.date) {
      const start = new Date(`${filters.date}T00:00:00.000Z`);
      const end = new Date(`${filters.date}T23:59:59.999Z`);
      where.issuedAt = { gte: start, lte: end };
    } else if (filters?.month) {
      // Month filter (e.g. "2026-11")
      const [yearStr, monthStr] = filters.month.split("-");
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10) - 1;
      const start = new Date(Date.UTC(year, month, 1));
      const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      where.issuedAt = { gte: start, lte: end };
    } else if (filters?.fromDate || filters?.toDate) {
      // Date range filter
      where.issuedAt = {};
      if (filters.fromDate) {
        where.issuedAt.gte = new Date(`${filters.fromDate}T00:00:00.000Z`);
      }
      if (filters.toDate) {
        where.issuedAt.lte = new Date(`${filters.toDate}T23:59:59.999Z`);
      }
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        items: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            source: true,
            status: true,
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    });

    return {
      success: true,
      count: invoices.length,
      data: invoices,
    };
  }

  /**
   * Aggregate statistics matching LKpos screen (Page 2, Figure 1)
   */
  async getInvoiceStats() {
    const invoices = await this.prisma.invoice.findMany({
      select: {
        totalAmount: true,
        discountAmount: true,
        paidAmount: true,
        balance: true,
        returnValue: true,
        creditBilled: true,
        status: true,
      },
    });

    let totalAmount = 0;
    let totalOffers = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalReturn = 0;
    let totalCreditBilled = 0;

    for (const inv of invoices) {
      if (inv.status !== InvoiceStatus.VOID) {
        totalAmount += inv.totalAmount;
        totalOffers += inv.discountAmount;
        totalPaid += inv.paidAmount;
        totalOutstanding += Math.max(0, inv.balance);
        totalReturn += inv.returnValue;
        totalCreditBilled += inv.creditBilled;
      }
    }

    return {
      success: true,
      stats: {
        totalInvoices: invoices.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalOffers: Math.round(totalOffers * 100) / 100, // Aggregate discounts
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        totalReturn: Math.round(totalReturn * 100) / 100,
        totalCreditBilled: Math.round(totalCreditBilled * 100) / 100,
      },
    };
  }

  /**
   * Get single invoice by ID or Invoice Number
   */
  async getInvoiceById(id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [{ id }, { invoiceNumber: id }],
      },
      include: {
        items: true,
        order: true,
        customer: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    return { success: true, invoice };
  }

  /**
   * Create a new custom or manual invoice
   */
  async createInvoice(dto: CreateInvoiceDto) {
    const invoiceNumber = dto.invoiceNumber || (await this.generateNextInvoiceNumber());

    // Calculate line items
    let subtotal = 0;
    let totalDiscount = 0;
    const itemsData = (dto.items || []).map((it) => {
      const qty = Number(it.quantity) || 1;
      const unitPrice = Number(it.unitPrice) || 0;
      const disc = Number(it.discount) || 0;
      const taxRate = Number(it.taxRate) || 0;
      const lineBase = qty * unitPrice;
      const lineDisc = lineBase * (disc / 100);
      const lineTotal = it.totalPrice !== undefined ? Number(it.totalPrice) : Math.round((lineBase - lineDisc) * (1 + taxRate / 100) * 100) / 100;

      subtotal += lineBase;
      totalDiscount += lineDisc;

      return {
        productId: it.productId || null,
        sku: it.sku || `SKU-${it.unit ? it.unit.toUpperCase() : "ITM"}`,
        description: it.description,
        unit: it.unit || "pcs",
        quantity: qty,
        unitPrice,
        discount: disc,
        taxRate,
        totalPrice: lineTotal,
      };
    });

    const deliveryFee = Number(dto.deliveryFee) || 0;
    const totalAmount = Math.max(0, subtotal - totalDiscount + deliveryFee);
    const paidAmount = Number(dto.paidAmount) || 0;
    const creditBilled = Number(dto.creditBilled) || 0;
    const balance = Math.max(0, totalAmount - paidAmount - creditBilled);

    let status: InvoiceStatus = InvoiceStatus.ISSUED;
    if (balance <= 0) {
      status = InvoiceStatus.PAID;
    } else if (paidAmount > 0) {
      status = InvoiceStatus.PARTIAL;
    } else {
      status = InvoiceStatus.UNPAID;
    }

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        type: dto.type || InvoiceType.STANDARD,
        status,
        orderId: dto.orderId || null,
        customerId: dto.customerId || null,
        quotationId: dto.quotationId || null,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone || null,
        customerEmail: dto.customerEmail || null,
        billingAddress: dto.billingAddress || null,
        currency: dto.currency || "LKR",
        subtotal,
        discountAmount: totalDiscount,
        deliveryFee,
        totalAmount,
        paidAmount,
        creditBilled,
        balance,
        paymentMethod: dto.paymentMethod || "CASH",
        paymentStatus: balance <= 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID",
        notes: dto.notes || null,
        items: {
          create: itemsData,
        },
      },
      include: {
        items: true,
      },
    });

    this.realtime.broadcast(CHANNELS.POS_STOCK, "invoice.created", invoice);
    return { success: true, invoice };
  }

  /**
   * Record payment allocation against an issued invoice
   */
  async recordPayment(id: string, dto: RecordInvoicePaymentDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException("Cannot record payment against a voided invoice");
    }

    const paymentAmount = Number(dto.amount) || 0;
    const newPaidAmount = invoice.paidAmount + paymentAmount;
    const newBalance = Math.max(0, invoice.totalAmount - newPaidAmount - invoice.creditBilled);
    const newStatus = newBalance <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        paidAmount: newPaidAmount,
        balance: newBalance,
        status: newStatus,
        paymentStatus: newBalance <= 0 ? "PAID" : "PARTIAL",
        paymentMethod: dto.paymentMethod || invoice.paymentMethod,
      },
      include: { items: true },
    });

    this.realtime.broadcast(CHANNELS.POS_STOCK, "invoice.updated", updated);
    return { success: true, invoice: updated };
  }

  /**
   * Controlled reversal (Void) of an invoice with mandatory audit reason
   */
  async voidInvoice(id: string, dto: VoidInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException("Invoice is already voided");
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.VOID,
        voidReason: dto.reason || "Reversal requested by manager",
        voidedAt: new Date(),
        balance: 0,
      },
      include: { items: true },
    });

    this.realtime.broadcast(CHANNELS.POS_STOCK, "invoice.voided", updated);
    return { success: true, message: `Invoice ${invoice.invoiceNumber} voided`, invoice: updated };
  }

  /**
   * Synchronize existing Orders into Invoices ledger to ensure 100% data consistency
   */
  async syncOrdersToInvoices() {
    const orders = await this.prisma.order.findMany({
      where: {
        invoice: null, // Only orders without an invoice yet
      },
      include: {
        items: true,
      },
      orderBy: { createdAt: "asc" },
    });

    let syncedCount = 0;
    for (const ord of orders) {
      const invNum = `INV-${ord.orderNumber.replace(/[^0-9]/g, "").padStart(6, "0").slice(-6)}`;
      try {
        await this.prisma.invoice.create({
          data: {
            invoiceNumber: invNum,
            type: InvoiceType.POS_RECEIPT,
            status: ord.paymentStatus === "PAID" ? InvoiceStatus.PAID : ord.paymentStatus === "PARTIAL" ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID,
            issuedAt: ord.createdAt,
            orderId: ord.id,
            customerId: ord.customerId,
            customerName: ord.customerName,
            customerPhone: ord.customerPhone,
            billingAddress: ord.shippingAddress,
            subtotal: ord.subtotal,
            discountAmount: ord.discountAmount,
            taxAmount: ord.taxAmount,
            deliveryFee: ord.deliveryFee,
            totalAmount: ord.totalAmount,
            paidAmount: ord.cashReceived || (ord.paymentStatus === "PAID" ? ord.totalAmount : 0),
            balance: Math.max(0, ord.totalAmount - (ord.cashReceived || (ord.paymentStatus === "PAID" ? ord.totalAmount : 0))),
            paymentMethod: ord.paymentMethod,
            paymentStatus: ord.paymentStatus,
            items: {
              create: ord.items.map((it) => ({
                productId: it.productId,
                sku: it.sku,
                description: it.productName,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                discount: it.discount,
                totalPrice: it.totalPrice,
              })),
            },
          },
        });
        syncedCount++;
      } catch (e: any) {
        this.logger.warn(`Could not auto-sync order ${ord.orderNumber}: ${e.message}`);
      }
    }

    return { success: true, syncedCount };
  }
}
