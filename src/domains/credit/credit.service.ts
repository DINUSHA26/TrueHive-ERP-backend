import { Injectable, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService } from "@/infrastructure/realtime/realtime.service";

export interface CreateCustomerCreditBillDto {
  customerId: string;
  billNumber?: string;
  creditType?: string; // Credit, Cheque, Cash
  bankCheque?: string;
  chequeDate?: string;
  totalAmount: number;
  creditDays?: number;
  dueDate?: string;
  notes?: string;
}

export interface CustomerCreditPaymentDto {
  amount: number;
  paymentMethod: string; // CASH, CARD, BANK_TRANSFER, CHEQUE
  reference?: string;
  notes?: string;
}

export interface RecordPurchaseDto {
  supplierId: string;
  itemType: "PRODUCT" | "INGREDIENT";
  itemId: string;
  itemName: string;
  costPrice: number;
  sellingPrice?: number;
  offerPrice?: number;
  quantity: number;
  creditDays?: number;
  poGrnNumber?: string;
  invoiceNumber?: string;
  paymentOption: "CREDIT" | "CASH";
  notes?: string;
}

export interface CreateSupplierBillDto {
  supplierId: string;
  billNumber?: string;
  poGrnNumber?: string;
  invoiceNumber?: string;
  itemType?: "PRODUCT" | "INGREDIENT" | "GENERAL";
  items?: string;
  totalAmount: number;
  creditDays?: number;
  dueDate?: string;
  notes?: string;
}

export interface SupplierPaymentDto {
  amount: number;
  paymentMethod: string; // BANK_TRANSFER, CHEQUE, CASH
  reference?: string;
  notes?: string;
}

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ==========================================
  // CUSTOMER CREDIT (ACCOUNTS RECEIVABLE)
  // ==========================================

  async getCustomerCreditDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [bills, todayBills, todayPayments, monthBills, allUnpaid] = await Promise.all([
      this.prisma.customerCreditBill.findMany({
        include: {
          customer: true,
          payments: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { dateGiven: "desc" },
        take: 200,
      }),
      this.prisma.customerCreditBill.aggregate({
        _sum: { totalAmount: true },
        where: { dateGiven: { gte: today } },
      }),
      this.prisma.customerCreditPayment.aggregate({
        _sum: { amount: true },
        where: { paymentDate: { gte: today } },
      }),
      this.prisma.customerCreditBill.aggregate({
        _sum: { totalAmount: true },
        where: { dateGiven: { gte: firstDayOfMonth } },
      }),
      this.prisma.customerCreditBill.aggregate({
        _sum: { balance: true },
        where: { balance: { gt: 0 } },
      }),
    ]);

    // Update statuses for overdue bills dynamically
    const now = new Date();
    const formattedBills = bills.map((b) => {
      let currentStatus = b.status;
      if (b.balance > 0 && b.dueDate && new Date(b.dueDate) < now) {
        currentStatus = "OVERDUE";
      }
      return {
        ...b,
        status: currentStatus,
      };
    });

    return {
      success: true,
      stats: {
        todayCreditGiven: todayBills._sum.totalAmount || 0,
        todayPaymentsReceived: todayPayments._sum.amount || 0,
        thisMonthCredit: monthBills._sum.totalAmount || 0,
        totalRemainingBalance: allUnpaid._sum.balance || 0,
      },
      bills: formattedBills,
    };
  }

  async createCustomerCreditBill(dto: CreateCustomerCreditBillDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    const creditDays = dto.creditDays ?? customer.creditDays ?? 30;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);
    const billNumber = dto.billNumber || `CB-${Math.floor(100000 + Math.random() * 900000)}`;

    const [bill] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerCreditBill.create({
        data: {
          billNumber,
          customerId: customer.id,
          customerName: customer.name,
          creditType: dto.creditType || "Credit",
          bankCheque: dto.bankCheque,
          chequeDate: dto.chequeDate ? new Date(dto.chequeDate) : null,
          totalAmount: dto.totalAmount,
          paidAmount: 0,
          balance: dto.totalAmount,
          dueDate,
          status: "PENDING",
          notes: dto.notes,
        },
        include: {
          customer: true,
          payments: true,
        },
      });

      // Update customer credit balance
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          creditBalance: { increment: dto.totalAmount },
        },
      });

      return [created];
    });

    return {
      success: true,
      bill,
    };
  }

  async recordCustomerCreditPayment(billId: string, dto: CustomerCreditPaymentDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException("Payment amount must be greater than 0");
    }

    const bill = await this.prisma.customerCreditBill.findUnique({
      where: { id: billId },
      include: { customer: true },
    });

    if (!bill) {
      throw new NotFoundException("Credit bill not found");
    }

    if (dto.amount > bill.balance) {
      throw new BadRequestException(`Payment amount (Rs. ${dto.amount}) exceeds outstanding balance (Rs. ${bill.balance})`);
    }

    const newPaidAmount = bill.paidAmount + dto.amount;
    const newBalance = Math.max(0, bill.totalAmount - newPaidAmount);
    const newStatus = newBalance === 0 ? "PAID" : "PARTIAL";

    const [payment, updatedBill] = await this.prisma.$transaction(async (tx) => {
      const p = await tx.customerCreditPayment.create({
        data: {
          billId: bill.id,
          customerId: bill.customerId,
          amount: dto.amount,
          paymentDate: new Date(),
          paymentMethod: dto.paymentMethod || "CASH",
          reference: dto.reference,
          notes: dto.notes,
        },
      });

      const b = await tx.customerCreditBill.update({
        where: { id: bill.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newStatus,
        },
        include: { customer: true, payments: true },
      });

      // Decrement customer's total credit balance
      await tx.customer.update({
        where: { id: bill.customerId },
        data: {
          creditBalance: { decrement: dto.amount },
        },
      });

      // Record CashFlow entry for finance ledger
      await tx.cashFlowTransaction.create({
        data: {
          transactionCode: `CPAY-${Math.floor(100000 + Math.random() * 900000)}`,
          amount: dto.amount,
          type: "INCOME",
          category: "CUSTOMER_CREDIT_RECOVERY",
          description: `Customer Credit Settlement for Bill #${bill.billNumber} (${bill.customerName})`,
          paymentMethod: dto.paymentMethod || "CASH",
        },
      });

      // Sync payment to matching Invoice and Order in the database
      try {
        const invStatus = newBalance === 0 ? "PAID" : "PARTIAL";
        await tx.invoice.updateMany({
          where: {
            OR: [
              { invoiceNumber: bill.billNumber },
              ...(bill.orderId ? [{ orderId: bill.orderId }] : []),
            ],
          },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status: invStatus as any,
            paymentStatus: invStatus,
          },
        });

        if (bill.orderId) {
          await tx.order.update({
            where: { id: bill.orderId },
            data: {
              paymentStatus: invStatus,
            },
          });
        }
      } catch (e) {
        // Non-blocking sync
      }

      return [p, b];
    });

    return {
      success: true,
      payment,
      bill: updatedBill,
    };
  }

  async deleteCustomerCreditBill(billId: string) {
    const bill = await this.prisma.customerCreditBill.findUnique({
      where: { id: billId },
    });

    if (!bill) {
      throw new NotFoundException("Credit bill not found");
    }

    await this.prisma.$transaction(async (tx) => {
      // Revert customer credit balance for remaining unpaid portion
      if (bill.balance > 0) {
        await tx.customer.update({
          where: { id: bill.customerId },
          data: { creditBalance: { decrement: bill.balance } },
        });
      }

      await tx.customerCreditBill.delete({
        where: { id: billId },
      });
    });

    return { success: true, message: "Credit bill deleted successfully" };
  }

  async getCustomerHistory(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        creditBills: {
          include: { payments: true },
          orderBy: { dateGiven: "desc" },
        },
        creditPayments: {
          orderBy: { paymentDate: "desc" },
          take: 20,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    return {
      success: true,
      customer,
    };
  }

  // ==========================================
  // SUPPLIER BILLS & PURCHASING (ACCOUNTS PAYABLE)
  // ==========================================

  async getSupplierBillsDashboard() {
    const [bills, allUnpaid, allPaid] = await Promise.all([
      this.prisma.supplierBill.findMany({
        include: {
          supplier: true,
          payments: {
            orderBy: { paymentDate: "desc" },
          },
        },
        orderBy: { receivedDate: "desc" },
        take: 200,
      }),
      this.prisma.supplierBill.aggregate({
        _sum: { balance: true },
        where: { balance: { gt: 0 } },
      }),
      this.prisma.supplierBill.aggregate({
        _sum: { paidAmount: true },
      }),
    ]);

    const now = new Date();
    let totalOverdue = 0;

    const formattedBills = bills.map((b) => {
      let currentStatus = b.status;
      if (b.balance > 0 && b.dueDate && new Date(b.dueDate) < now) {
        currentStatus = "OVERDUE";
        totalOverdue += b.balance;
      }
      return {
        ...b,
        status: currentStatus,
      };
    });

    return {
      success: true,
      stats: {
        totalOwed: allUnpaid._sum.balance || 0,
        totalPaid: allPaid._sum.paidAmount || 0,
        totalOverdue,
      },
      bills: formattedBills,
    };
  }

  /**
   * Record Product or Ingredient Purchase (Credit or Cash)
   * Matches LKpos "Purchases" flow from ERP report:
   * Increments stock, updates cost/sale/offer prices, creates AP bill and cash outflow if cash.
   */
  async recordPurchase(dto: RecordPurchaseDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier not found");
    }

    const totalCost = Number(dto.costPrice) * Number(dto.quantity);
    if (isNaN(totalCost) || totalCost <= 0) {
      throw new BadRequestException("Invalid cost price or quantity");
    }

    const creditDays = dto.creditDays ?? supplier.creditDays ?? 30;
    const dueDate = new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);
    const billNumber =
      dto.invoiceNumber || dto.poGrnNumber || `SB-${Math.floor(100000 + Math.random() * 900000)}`;

    const isCredit = dto.paymentOption === "CREDIT";
    const initialPaid = isCredit ? 0 : totalCost;
    const initialBalance = isCredit ? totalCost : 0;
    const initialStatus = isCredit ? "DUE" : "PAID";

    const [bill] = await this.prisma.$transaction(async (tx) => {
      // 1. Stock increment & price adjustments
      if (dto.itemType === "PRODUCT") {
        const product = await tx.product.findUnique({ where: { id: dto.itemId } });
        if (!product) throw new NotFoundException(`Product not found: ${dto.itemId}`);

        const updateData: any = {
          currentStock: { increment: Number(dto.quantity) },
          costPrice: Number(dto.costPrice),
        };
        if (dto.sellingPrice && Number(dto.sellingPrice) > 0) {
          updateData.sellingPrice = Number(dto.sellingPrice);
        }
        if (dto.offerPrice !== undefined && Number(dto.offerPrice) >= 0) {
          updateData.offerPrice = Number(dto.offerPrice);
        }

        await tx.product.update({
          where: { id: dto.itemId },
          data: updateData,
        });
      } else if (dto.itemType === "INGREDIENT") {
        const ingredient = await tx.ingredient.findUnique({ where: { id: dto.itemId } });
        if (!ingredient) throw new NotFoundException(`Ingredient not found: ${dto.itemId}`);

        await tx.ingredient.update({
          where: { id: dto.itemId },
          data: {
            currentStock: { increment: Number(dto.quantity) },
            unitCost: Number(dto.costPrice),
          },
        });
      }

      // 2. Create Supplier Bill (AP)
      const createdBill = await tx.supplierBill.create({
        data: {
          billNumber,
          supplierId: supplier.id,
          supplierName: supplier.name,
          poGrnNumber: dto.poGrnNumber,
          invoiceNumber: dto.invoiceNumber,
          receivedDate: new Date(),
          invoiceDate: new Date(),
          creditDays,
          dueDate,
          totalAmount: totalCost,
          paidAmount: initialPaid,
          balance: initialBalance,
          status: initialStatus,
          itemType: dto.itemType,
          items: JSON.stringify([
            {
              itemId: dto.itemId,
              itemName: dto.itemName,
              itemType: dto.itemType,
              costPrice: dto.costPrice,
              sellingPrice: dto.sellingPrice,
              offerPrice: dto.offerPrice,
              quantity: dto.quantity,
              totalCost,
            },
          ]),
          notes: dto.notes,
        },
      });

      // 3. If Credit, increase supplier outstanding balance
      if (isCredit) {
        await tx.supplier.update({
          where: { id: supplier.id },
          data: { creditBalance: { increment: totalCost } },
        });
      } else {
        // Immediate Cash settlement: record payment and cash flow expense
        await tx.supplierBillPayment.create({
          data: {
            billId: createdBill.id,
            supplierId: supplier.id,
            amount: totalCost,
            paymentDate: new Date(),
            paymentMethod: "CASH",
            reference: dto.invoiceNumber || dto.poGrnNumber,
            notes: "Immediate cash settlement on purchase",
          },
        });

        await tx.cashFlowTransaction.create({
          data: {
            transactionCode: `PUR-${Math.floor(100000 + Math.random() * 900000)}`,
            amount: totalCost,
            type: "EXPENSE",
            category: "INVENTORY_PURCHASE",
            description: `Cash Purchase: ${dto.itemName} (${dto.quantity} units from ${supplier.name})`,
            paymentMethod: "CASH",
          },
        });
      }

      return [createdBill];
    });

    // Broadcast stock updates
    await this.realtime.broadcastStock("stock-updated", {
      itemType: dto.itemType,
      itemId: dto.itemId,
      quantity: dto.quantity,
    });

    return {
      success: true,
      bill,
      totalCost,
    };
  }

  async createSupplierBill(dto: CreateSupplierBillDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier not found");
    }

    const creditDays = dto.creditDays ?? supplier.creditDays ?? 30;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);
    const billNumber = dto.billNumber || `SB-${Math.floor(100000 + Math.random() * 900000)}`;

    const [bill] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierBill.create({
        data: {
          billNumber,
          supplierId: supplier.id,
          supplierName: supplier.name,
          poGrnNumber: dto.poGrnNumber,
          invoiceNumber: dto.invoiceNumber,
          receivedDate: new Date(),
          invoiceDate: new Date(),
          creditDays,
          dueDate,
          totalAmount: dto.totalAmount,
          paidAmount: 0,
          balance: dto.totalAmount,
          status: "DUE",
          itemType: dto.itemType || "GENERAL",
          items: dto.items,
          notes: dto.notes,
        },
        include: { supplier: true, payments: true },
      });

      await tx.supplier.update({
        where: { id: supplier.id },
        data: { creditBalance: { increment: dto.totalAmount } },
      });

      return [created];
    });

    return {
      success: true,
      bill,
    };
  }

  async recordSupplierPayment(billId: string, dto: SupplierPaymentDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException("Payment amount must be greater than 0");
    }

    const bill = await this.prisma.supplierBill.findUnique({
      where: { id: billId },
      include: { supplier: true },
    });

    if (!bill) {
      throw new NotFoundException("Supplier bill not found");
    }

    if (dto.amount > bill.balance) {
      throw new BadRequestException(`Payment amount (Rs. ${dto.amount}) exceeds outstanding bill balance (Rs. ${bill.balance})`);
    }

    const newPaidAmount = bill.paidAmount + dto.amount;
    const newBalance = Math.max(0, bill.totalAmount - newPaidAmount);
    const newStatus = newBalance === 0 ? "PAID" : "PARTIAL";

    const [payment, updatedBill] = await this.prisma.$transaction(async (tx) => {
      const p = await tx.supplierBillPayment.create({
        data: {
          billId: bill.id,
          supplierId: bill.supplierId,
          amount: dto.amount,
          paymentDate: new Date(),
          paymentMethod: dto.paymentMethod || "BANK_TRANSFER",
          reference: dto.reference,
          notes: dto.notes,
        },
      });

      const b = await tx.supplierBill.update({
        where: { id: bill.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newStatus,
        },
        include: { supplier: true, payments: true },
      });

      // Reduce supplier credit balance
      await tx.supplier.update({
        where: { id: bill.supplierId },
        data: { creditBalance: { decrement: dto.amount } },
      });

      // Log CashFlow Expense
      await tx.cashFlowTransaction.create({
        data: {
          transactionCode: `SPAY-${Math.floor(100000 + Math.random() * 900000)}`,
          amount: dto.amount,
          type: "EXPENSE",
          category: "SUPPLIER_PAYMENT",
          description: `Supplier Payment for Bill #${bill.billNumber} (${bill.supplierName})`,
          paymentMethod: dto.paymentMethod || "BANK_TRANSFER",
        },
      });

      // Sync payment to matching PO / Invoice in the database
      try {
        const invStatus = newBalance === 0 ? "PAID" : "PARTIAL";
        await tx.invoice.updateMany({
          where: {
            OR: [
              { invoiceNumber: bill.billNumber },
              ...(bill.poGrnNumber ? [{ invoiceNumber: bill.poGrnNumber }] : []),
            ],
          },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status: invStatus as any,
            paymentStatus: invStatus,
          },
        });
      } catch (e) {
        // Non-blocking sync
      }

      return [p, b];
    });

    return {
      success: true,
      payment,
      bill: updatedBill,
    };
  }

  async deleteSupplierBill(billId: string) {
    const bill = await this.prisma.supplierBill.findUnique({
      where: { id: billId },
    });

    if (!bill) {
      throw new NotFoundException("Supplier bill not found");
    }

    await this.prisma.$transaction(async (tx) => {
      if (bill.balance > 0) {
        await tx.supplier.update({
          where: { id: bill.supplierId },
          data: { creditBalance: { decrement: bill.balance } },
        });
      }

      await tx.supplierBill.delete({
        where: { id: billId },
      });
    });

    return { success: true, message: "Supplier bill deleted successfully" };
  }

  async bulkImportSupplierBills(billsData: any[]) {
    if (!Array.isArray(billsData) || billsData.length === 0) {
      throw new BadRequestException("Bills array is empty");
    }

    const suppliers = await this.prisma.supplier.findMany();
    const supplierByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]));

    let importedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of billsData) {
        const supplierName = (row.supplierName || row.supplier || "").trim();
        let supplier = supplierByName.get(supplierName.toLowerCase());

        if (!supplier && supplierName) {
          // Auto create supplier if not found
          const supCount = await tx.supplier.count();
          const supplierCode = `SUPP-${String(supCount + 1).padStart(4, "0")}`;
          supplier = await tx.supplier.create({
            data: {
              supplierCode,
              name: supplierName,
              contactPerson: row.contactPerson || "Manager",
              phone: row.phone || "0112000000",
              creditLimit: Number(row.creditLimit) || 100000,
              creditDays: Number(row.creditDays) || 30,
            },
          });
          supplierByName.set(supplier.name.trim().toLowerCase(), supplier);
        }

        if (!supplier) continue;

        const totalAmount = Number(row.totalAmount || row.amount || 0);
        const paidAmount = Number(row.paidAmount || 0);
        const balance = Math.max(0, totalAmount - paidAmount);
        const creditDays = Number(row.creditDays) || supplier.creditDays || 30;
        const dueDate = row.dueDate ? new Date(row.dueDate) : new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);
        const billNumber = row.billNumber || `SB-${Math.floor(100000 + Math.random() * 900000)}`;

        await tx.supplierBill.create({
          data: {
            billNumber,
            supplierId: supplier.id,
            supplierName: supplier.name,
            poGrnNumber: row.poGrnNumber || row.grn,
            invoiceNumber: row.invoiceNumber || row.invoice,
            receivedDate: row.receivedDate ? new Date(row.receivedDate) : new Date(),
            invoiceDate: row.invoiceDate ? new Date(row.invoiceDate) : new Date(),
            creditDays,
            dueDate,
            totalAmount,
            paidAmount,
            balance,
            status: balance === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "DUE",
            itemType: row.itemType || "GENERAL",
            notes: row.notes,
          },
        });

        if (balance > 0) {
          await tx.supplier.update({
            where: { id: supplier.id },
            data: { creditBalance: { increment: balance } },
          });
        }

        importedCount++;
      }
    });

    return {
      success: true,
      importedCount,
    };
  }
}
