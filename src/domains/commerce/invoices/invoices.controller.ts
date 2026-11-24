import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto, RecordInvoicePaymentDto, VoidInvoiceDto } from "./dto/create-invoice.dto";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "List all invoices with filters (search, date, month, range, status)" })
  async getInvoices(
    @Query("search") search?: string,
    @Query("date") date?: string,
    @Query("month") month?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
    @Query("status") status?: string,
  ) {
    return this.invoicesService.getInvoices({
      search,
      date,
      month,
      fromDate,
      toDate,
      status,
    });
  }

  @Public()
  @Get("stats")
  @ApiOperation({ summary: "Get aggregate invoice KPIs (Total Billed, Offers, Paid, Outstanding, Returns)" })
  async getInvoiceStats() {
    return this.invoicesService.getInvoiceStats();
  }

  @Public()
  @Get("next-number")
  @ApiOperation({ summary: "Get next sequential invoice number (e.g. INV-858001)" })
  async getNextInvoiceNumber() {
    const nextNumber = await this.invoicesService.generateNextInvoiceNumber();
    return { success: true, nextNumber };
  }

  @Public()
  @Get(":id")
  @ApiOperation({ summary: "Get invoice details by ID or Invoice Number" })
  async getInvoiceById(@Param("id") id: string) {
    return this.invoicesService.getInvoiceById(id);
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Create new custom or manual invoice" })
  async createInvoice(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(dto);
  }

  @Public()
  @Post(":id/payments")
  @ApiOperation({ summary: "Record payment allocation against invoice" })
  async recordPayment(
    @Param("id") id: string,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    return this.invoicesService.recordPayment(id, dto);
  }

  @Public()
  @Post(":id/void")
  @ApiOperation({ summary: "Controlled reversal (void) of invoice" })
  async voidInvoice(
    @Param("id") id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.invoicesService.voidInvoice(id, dto);
  }

  @Public()
  @Post("sync-orders")
  @ApiOperation({ summary: "Sync orders into central invoice ledger" })
  async syncOrders() {
    return this.invoicesService.syncOrdersToInvoices();
  }
}
