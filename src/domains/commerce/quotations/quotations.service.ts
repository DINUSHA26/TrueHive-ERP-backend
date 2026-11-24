import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService, CHANNELS } from "@/infrastructure/realtime/realtime.service";
import { CreateQuotationDto, ConvertToInvoiceDto } from "./dto/create-quotation.dto";
import { QuotationStatus, OrderSource, OrderStatus, PaymentMethod, PaymentStatus } from "@prisma/client";

export function numberToWords(num: number): string {
  if (isNaN(num) || num === 0) return "Zero Rupees Only";
  const a = [
    "", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ",
    "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    const digit = n % 10;
    if (n < 100) return b[Math.floor(n / 10)] + (digit ? "-" + a[digit] : " ");
    if (n < 1000) return inWords(Math.floor(n / 100)) + "Hundred " + (n % 100 ? "and " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + "Thousand " + (n % 1000 ? inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + "Lakh " + (n % 100000 ? inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + "Crore " + (n % 10000000 ? inWords(n % 10000000) : "");
  }

  const rounded = Math.floor(num);
  const cents = Math.round((num - rounded) * 100);
  let result = inWords(rounded).trim() + " Rupees";
  if (cents > 0) {
    result += " and " + inWords(cents).trim() + " Cents";
  }
  return result + " Only";
}

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Generate next sequential Quote Number (e.g. QT-1001, QT-1002)
   */
  async generateNextQuoteNumber(): Promise<string> {
    const lastQuote = await this.prisma.quotation.findFirst({
      orderBy: { createdAt: "desc" },
      select: { quoteNumber: true },
    });

    if (!lastQuote || !lastQuote.quoteNumber) {
      return "QT-1001";
    }

    const match = lastQuote.quoteNumber.match(/QT-(\d+)/i);
    if (match) {
      const nextNum = parseInt(match[1], 10) + 1;
      return `QT-${nextNum}`;
    }

    return `QT-${Date.now().toString().slice(-4)}`;
  }

  /**
   * List all quotations with optional search query
   */
  async getQuotations(query?: string) {
    const where: any = {};
    if (query && query.trim()) {
      const q = query.trim();
      where.OR = [
        { quoteNumber: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
        { clientPhone: { contains: q, mode: "insensitive" } },
        { clientEmail: { contains: q, mode: "insensitive" } },
        { projectTitle: { contains: q, mode: "insensitive" } },
        { projectDesc: { contains: q, mode: "insensitive" } },
      ];
    }

    const quotes = await this.prisma.quotation.findMany({
      where,
      include: {
        items: {
          orderBy: { itemIndex: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      count: quotes.length,
      data: quotes,
    };
  }

  /**
   * Get single quotation by ID or Quote Number
   */
  async getQuotationById(id: string) {
    const quote = await this.prisma.quotation.findFirst({
      where: {
        OR: [{ id }, { quoteNumber: id }],
      },
      include: {
        items: {
          orderBy: { itemIndex: "asc" },
        },
        customer: true,
        order: true,
      },
    });

    if (!quote) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }

    return { success: true, quotation: quote };
  }

  /**
   * Create a new quotation
   */
  async createQuotation(dto: CreateQuotationDto) {
    const quoteNumber = dto.quoteNumber || (await this.generateNextQuoteNumber());

    // Calculate line items and totals
    let calculatedSubtotal = 0;
    const itemsData = (dto.items || []).map((item, idx) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const discount = Number(item.discount) || 0;
      const taxPercent = Number(item.taxPercent) || 0;

      // Item amount calculation
      const lineSubtotal = qty * unitPrice;
      const discounted = lineSubtotal * (1 - discount / 100);
      const rowAmount = item.amount !== undefined ? Number(item.amount) : Math.round(discounted * (1 + taxPercent / 100) * 100) / 100;

      calculatedSubtotal += rowAmount;

      return {
        itemIndex: idx + 1,
        productId: item.productId || null,
        description: item.description || "Item",
        unit: item.unit || "Pcs",
        quantity: qty,
        unitPrice: unitPrice,
        discount: discount,
        taxPercent: taxPercent,
        amount: rowAmount,
      };
    });

    const discountAmount = Number(dto.discountAmount) || 0;
    const taxPercent = Number(dto.taxPercent) || 0;
    const taxAmount = (calculatedSubtotal - discountAmount) * (taxPercent / 100);
    const finalAmount = Math.max(0, calculatedSubtotal - discountAmount + taxAmount);
    const amountPaid = Number(dto.amountPaid) || 0;
    const balance = Math.max(0, finalAmount - amountPaid);
    const amountInWords = dto.amountInWords || numberToWords(finalAmount);

    const quotation = await this.prisma.quotation.create({
      data: {
        quoteNumber,
        date: dto.date ? new Date(dto.date) : new Date(),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        status: QuotationStatus.DRAFT,
        customerId: dto.customerId || null,
        clientName: dto.clientName,
        clientPhone: dto.clientPhone || null,
        clientEmail: dto.clientEmail || null,
        clientAddress: dto.clientAddress || null,
        projectTitle: dto.projectTitle || null,
        projectDesc: dto.projectDesc || null,
        preparedBy: dto.preparedBy || "Fashion dora",
        notes: dto.notes || null,
        subtotal: calculatedSubtotal,
        discountAmount,
        discountPercent: dto.discountPercent || 0,
        taxPercent,
        taxAmount,
        finalAmount,
        amountPaid,
        balance,
        amountInWords,
        items: {
          create: itemsData,
        },
      },
      include: {
        items: true,
      },
    });

    this.realtime.broadcast(CHANNELS.POS_STOCK, "quotation.created", quotation);
    return { success: true, quotation };
  }

  /**
   * Update an existing quotation
   */
  async updateQuotation(id: string, dto: Partial<CreateQuotationDto>) {
    const existing = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }

    // If items are provided, replace them
    let itemsData: any = undefined;
    let calculatedSubtotal = existing.subtotal;

    if (dto.items && dto.items.length > 0) {
      calculatedSubtotal = 0;
      itemsData = dto.items.map((item, idx) => {
        const qty = Number(item.quantity) || 1;
        const unitPrice = Number(item.unitPrice) || 0;
        const discount = Number(item.discount) || 0;
        const taxPercent = Number(item.taxPercent) || 0;
        const lineSubtotal = qty * unitPrice;
        const discounted = lineSubtotal * (1 - discount / 100);
        const rowAmount = item.amount !== undefined ? Number(item.amount) : Math.round(discounted * (1 + taxPercent / 100) * 100) / 100;
        calculatedSubtotal += rowAmount;

        return {
          itemIndex: idx + 1,
          productId: item.productId || null,
          description: item.description,
          unit: item.unit || "Pcs",
          quantity: qty,
          unitPrice: unitPrice,
          discount: discount,
          taxPercent: taxPercent,
          amount: rowAmount,
        };
      });
    }

    const discountAmount = dto.discountAmount !== undefined ? Number(dto.discountAmount) : existing.discountAmount;
    const taxPercent = dto.taxPercent !== undefined ? Number(dto.taxPercent) : existing.taxPercent;
    const taxAmount = (calculatedSubtotal - discountAmount) * (taxPercent / 100);
    const finalAmount = Math.max(0, calculatedSubtotal - discountAmount + taxAmount);
    const amountPaid = dto.amountPaid !== undefined ? Number(dto.amountPaid) : existing.amountPaid;
    const balance = Math.max(0, finalAmount - amountPaid);
    const amountInWords = dto.amountInWords || numberToWords(finalAmount);

    // Delete existing items and recreate if updated
    if (itemsData) {
      await this.prisma.quotationItem.deleteMany({
        where: { quotationId: id },
      });
    }

    const updated = await this.prisma.quotation.update({
      where: { id },
      data: {
        ...(dto.clientName && { clientName: dto.clientName }),
        ...(dto.clientPhone !== undefined && { clientPhone: dto.clientPhone }),
        ...(dto.clientEmail !== undefined && { clientEmail: dto.clientEmail }),
        ...(dto.clientAddress !== undefined && { clientAddress: dto.clientAddress }),
        ...(dto.projectTitle !== undefined && { projectTitle: dto.projectTitle }),
        ...(dto.projectDesc !== undefined && { projectDesc: dto.projectDesc }),
        ...(dto.preparedBy !== undefined && { preparedBy: dto.preparedBy }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        subtotal: calculatedSubtotal,
        discountAmount,
        taxPercent,
        taxAmount,
        finalAmount,
        amountPaid,
        balance,
        amountInWords,
        ...(itemsData && {
          items: {
            create: itemsData,
          },
        }),
      },
      include: {
        items: true,
      },
    });

    this.realtime.broadcast(CHANNELS.POS_STOCK, "quotation.updated", updated);
    return { success: true, quotation: updated };
  }

  /**
   * Delete a quotation
   */
  async deleteQuotation(id: string) {
    const existing = await this.prisma.quotation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }

    await this.prisma.quotation.delete({ where: { id } });
    this.realtime.broadcast(CHANNELS.POS_STOCK, "quotation.deleted", { id });
    return { success: true, message: `Quotation ${existing.quoteNumber} deleted` };
  }

  /**
   * Make Invoice: Convert Quotation into an official Invoice / POS Order
   */
  async convertToInvoice(id: string, dto: ConvertToInvoiceDto) {
    const quote = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!quote) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }

    const invoiceNumber = dto.invoiceNumber || `INV-${Math.floor(100000 + Math.random() * 900000)}`;
    const paymentMethodStr = (dto.paymentMethod || "CASH").toUpperCase();

    // Map payment method
    let prismaPaymentMethod: PaymentMethod = PaymentMethod.CASH;
    if (paymentMethodStr === "CARD") prismaPaymentMethod = PaymentMethod.CARD;
    else if (paymentMethodStr === "BANK_TRANSFER" || paymentMethodStr === "ONLINE") prismaPaymentMethod = PaymentMethod.BANK_TRANSFER;
    else if (paymentMethodStr === "COD") prismaPaymentMethod = PaymentMethod.COD;
    else if (paymentMethodStr === "SPLIT") prismaPaymentMethod = PaymentMethod.SPLIT;

    const amountPaid = dto.amountPaid !== undefined ? Number(dto.amountPaid) : quote.finalAmount;
    const balance = Math.max(0, quote.finalAmount - amountPaid);
    const paymentStatus: PaymentStatus = balance <= 0 ? PaymentStatus.PAID : amountPaid > 0 ? PaymentStatus.PARTIAL : PaymentStatus.UNPAID;

    // Check if an order already exists for this quotation
    let order = quote.orderId
      ? await this.prisma.order.findUnique({ where: { id: quote.orderId } })
      : null;

    if (!order) {
      const orderNumber = `#POS-${invoiceNumber.replace("INV-", "")}`;
      const barcode = `INV${Date.now().toString().slice(-8)}`;

      // Create line items for Order
      const orderItemsData = quote.items.map((it) => ({
        productId: it.productId || "custom-item",
        productName: it.description + (it.unit ? ` (${it.unit})` : ""),
        sku: `SKU-${it.unit ? it.unit.toUpperCase() : "ITM"}`,
        barcode: `BC-${Date.now().toString().slice(-6)}-${it.itemIndex}`,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        unitCogs: 0,
        discount: it.discount,
        totalPrice: it.amount,
      }));

      // Create new Order
      order = await this.prisma.order.create({
        data: {
          orderNumber,
          barcode,
          customerId: quote.customerId || null,
          customerName: quote.clientName,
          customerPhone: quote.clientPhone || "0000000000",
          shippingAddress: quote.clientAddress || "In-store pickup / POS",
          source: OrderSource.POS_TERMINAL,
          status: OrderStatus.CONFIRMED,
          paymentMethod: prismaPaymentMethod,
          paymentStatus: paymentStatus,
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          taxAmount: quote.taxAmount,
          totalAmount: quote.finalAmount,
          cashReceived: amountPaid,
          changeGiven: 0,
          notes: `Generated from Quotation ${quote.quoteNumber}. ${dto.notes || ""}`,
          items: {
            create: orderItemsData,
          },
        },
      });
    }

    // Update Quotation state to INVOICED
    const updatedQuotation = await this.prisma.quotation.update({
      where: { id },
      data: {
        convertedToInvoice: true,
        invoiceNumber,
        invoicedAt: new Date(),
        status: QuotationStatus.INVOICED,
        paymentMethod: dto.paymentMethod || "Cash",
        amountPaid,
        balance,
        orderId: order.id,
      },
      include: {
        items: true,
      },
    });

    this.realtime.broadcast(CHANNELS.POS_STOCK, "quotation.invoiced", {
      quotation: updatedQuotation,
      order,
      invoiceNumber,
    });

    return {
      success: true,
      message: `Quotation ${quote.quoteNumber} successfully converted to Invoice ${invoiceNumber}`,
      invoiceNumber,
      quotation: updatedQuotation,
      order,
    };
  }
}
