import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { CreditService } from "./credit.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Credit Management")
@Controller("credit")
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  // ------------------------------------
  // Customer Credit Endpoints
  // ------------------------------------

  @Public()
  @Get("customer-bills")
  @ApiOperation({ summary: "Get customer credit dashboard stats and bills table" })
  async getCustomerCreditDashboard() {
    return this.creditService.getCustomerCreditDashboard();
  }

  @Public()
  @Post("customer-bills")
  @ApiOperation({ summary: "Create manual customer credit bill" })
  async createCustomerCreditBill(@Body() body: any) {
    return this.creditService.createCustomerCreditBill(body);
  }

  @Public()
  @Post("customer-bills/:id/pay")
  @ApiOperation({ summary: "Settle full or partial customer credit payment" })
  async recordCustomerCreditPayment(@Param("id") id: string, @Body() body: any) {
    return this.creditService.recordCustomerCreditPayment(id, body);
  }

  @Public()
  @Delete("customer-bills/:id")
  @ApiOperation({ summary: "Delete customer credit bill" })
  async deleteCustomerCreditBill(@Param("id") id: string) {
    return this.creditService.deleteCustomerCreditBill(id);
  }

  @Public()
  @Get("customers/:id/history")
  @ApiOperation({ summary: "Get full customer invoice & credit history" })
  async getCustomerHistory(@Param("id") id: string) {
    return this.creditService.getCustomerHistory(id);
  }

  // ------------------------------------
  // Supplier Ledger & Purchases Endpoints
  // ------------------------------------

  @Public()
  @Get("supplier-bills")
  @ApiOperation({ summary: "Get supplier ledger dashboard stats and bills table" })
  async getSupplierBillsDashboard() {
    return this.creditService.getSupplierBillsDashboard();
  }

  @Public()
  @Post("purchase")
  @ApiOperation({ summary: "Record product or raw ingredient purchase on cash or credit" })
  async recordPurchase(@Body() body: any) {
    return this.creditService.recordPurchase(body);
  }

  @Public()
  @Post("supplier-bills")
  @ApiOperation({ summary: "Create manual supplier bill" })
  async createSupplierBill(@Body() body: any) {
    return this.creditService.createSupplierBill(body);
  }

  @Public()
  @Post("supplier-bills/:id/pay")
  @ApiOperation({ summary: "Settle supplier bill payment" })
  async recordSupplierPayment(@Param("id") id: string, @Body() body: any) {
    return this.creditService.recordSupplierPayment(id, body);
  }

  @Public()
  @Delete("supplier-bills/:id")
  @ApiOperation({ summary: "Delete supplier bill" })
  async deleteSupplierBill(@Param("id") id: string) {
    return this.creditService.deleteSupplierBill(id);
  }

  @Public()
  @Post("supplier-bills/bulk-import")
  @ApiOperation({ summary: "Bulk import supplier bills from CSV" })
  async bulkImportSupplierBills(@Body() body: any) {
    const bills = Array.isArray(body) ? body : body.bills;
    return this.creditService.bulkImportSupplierBills(bills);
  }
}
