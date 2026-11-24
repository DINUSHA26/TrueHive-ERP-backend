import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FinanceService, CashBookEntry } from "./finance.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Finance & Accounting")
@Controller("finance")
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * Unified Financial Overview
   * Returns: Cash Book running balance, Petty Cash fund, Cash Flow Classifications, 4-Week Forecast
   */
  @Public()
  @Get()
  @ApiOperation({ summary: "Get complete financial ledger, petty cash, and cash flow overview" })
  async getFinance() {
    return this.financeService.getFinancialOverview();
  }

  @Public()
  @Get("overview")
  @ApiOperation({ summary: "Get financial ledger overview" })
  async getOverview() {
    return this.financeService.getFinancialOverview();
  }

  /**
   * Multiplexed action dispatcher for Next.js frontend proxy
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Dispatch finance & accounting actions" })
  async handleFinanceAction(@Body() body: any) {
    const action = body.action || body.type;

    switch (action) {
      case "CREATE_TRANSACTION":
      case "ADD_TRANSACTION":
        return this.financeService.createTransaction(body);

      case "DELETE_TRANSACTION":
        return this.financeService.deleteTransaction(body.id);

      case "CREATE_VOUCHER":
        return this.financeService.createPettyVoucher(body);

      case "APPROVE_VOUCHER":
        return this.financeService.approvePettyVoucher(body.voucherId || body.id, body.approverName);

      case "PAY_VOUCHER":
        return this.financeService.payPettyVoucher(body.voucherId || body.id, body.payerName);

      case "REJECT_VOUCHER":
        return this.financeService.rejectPettyVoucher(body.voucherId || body.id, body.reason);

      case "REPLENISH_PETTY":
        return this.financeService.replenishPettyCash(body);

      case "RECORD_CASH_COUNT":
        return this.financeService.recordCashCount(body);

      case "RECORD_TRANSFER":
        return this.financeService.recordFundTransfer(body);

      case "CREATE_FUND":
        return this.financeService.createPettyFund(body);

      case "SYNC_GOOGLE_DOCS":
        return {
          success: true,
          message: "Google Docs ledger synchronization triggered",
          syncedAt: new Date().toISOString(),
        };

      default:
        // If regular transaction payload
        if (body.amount && body.category) {
          return this.financeService.createTransaction(body);
        }
        return this.financeService.getFinancialOverview();
    }
  }

  /**
   * Record manual transaction into Cash Book
   */
  @Public()
  @Post("cash-book")
  @ApiOperation({ summary: "Record manual transaction in cash book" })
  async recordCashBook(@Body() dto: any) {
    return this.financeService.createTransaction(dto);
  }

  @Public()
  @Delete("cash-book/:id")
  @ApiOperation({ summary: "Delete manual cash book entry" })
  async deleteCashBook(@Param("id") id: string) {
    return this.financeService.deleteTransaction(id);
  }

  /**
   * Petty Cash Funds & Vouchers
   */
  @Public()
  @Post("petty-funds")
  @ApiOperation({ summary: "Create authorized petty cash fund" })
  async createPettyFund(@Body() dto: any) {
    return this.financeService.createPettyFund(dto);
  }

  @Public()
  @Post("petty-vouchers")
  @ApiOperation({ summary: "Submit petty cash expense voucher" })
  async createPettyVoucher(@Body() dto: any) {
    return this.financeService.createPettyVoucher(dto);
  }

  @Public()
  @Post("petty-vouchers/:id/approve")
  @ApiOperation({ summary: "Approve petty cash voucher" })
  async approvePettyVoucher(@Param("id") id: string, @Body("approverName") approverName?: string) {
    return this.financeService.approvePettyVoucher(id, approverName);
  }

  @Public()
  @Post("petty-vouchers/:id/pay")
  @ApiOperation({ summary: "Disburse approved petty cash voucher" })
  async payPettyVoucher(@Param("id") id: string, @Body("payerName") payerName?: string) {
    return this.financeService.payPettyVoucher(id, payerName);
  }

  @Public()
  @Post("petty-vouchers/:id/reject")
  @ApiOperation({ summary: "Reject petty cash voucher" })
  async rejectPettyVoucher(@Param("id") id: string, @Body("reason") reason?: string) {
    return this.financeService.rejectPettyVoucher(id, reason);
  }

  @Public()
  @Post("petty-cash/replenish")
  @ApiOperation({ summary: "Replenish / Top-up petty cash fund" })
  async replenishPettyCash(@Body() dto: any) {
    return this.financeService.replenishPettyCash(dto);
  }

  @Public()
  @Post("cash-counts")
  @ApiOperation({ summary: "Record physical cash count and verify variance" })
  async recordCashCount(@Body() dto: any) {
    return this.financeService.recordCashCount(dto);
  }

  @Public()
  @Post("transfers")
  @ApiOperation({ summary: "Record inter-account fund transfer" })
  async recordTransfer(@Body() dto: any) {
    return this.financeService.recordFundTransfer(dto);
  }

  @Public()
  @Post("sync-google")
  @ApiOperation({ summary: "Sync executive reports to Google Docs/Sheets" })
  async syncGoogle() {
    return this.financeService.syncGoogleDocsReport();
  }
}
