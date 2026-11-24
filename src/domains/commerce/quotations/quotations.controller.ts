import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { QuotationsService } from "./quotations.service";
import { CreateQuotationDto, ConvertToInvoiceDto } from "./dto/create-quotation.dto";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("quotations")
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "List all quotations with optional search query" })
  async getQuotations(@Query("search") search?: string) {
    return this.quotationsService.getQuotations(search);
  }

  @Public()
  @Get("next-number")
  @ApiOperation({ summary: "Get next sequential quote number (e.g. QT-1002)" })
  async getNextQuoteNumber() {
    const nextNumber = await this.quotationsService.generateNextQuoteNumber();
    return { success: true, nextNumber };
  }

  @Public()
  @Get(":id")
  @ApiOperation({ summary: "Get quotation by ID or Quote Number" })
  async getQuotationById(@Param("id") id: string) {
    return this.quotationsService.getQuotationById(id);
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Create new quotation" })
  async createQuotation(@Body() dto: CreateQuotationDto) {
    return this.quotationsService.createQuotation(dto);
  }

  @Public()
  @Put(":id")
  @ApiOperation({ summary: "Update quotation by ID" })
  async updateQuotation(@Param("id") id: string, @Body() dto: Partial<CreateQuotationDto>) {
    return this.quotationsService.updateQuotation(id, dto);
  }

  @Public()
  @Patch(":id")
  @ApiOperation({ summary: "Patch quotation by ID" })
  async patchQuotation(@Param("id") id: string, @Body() dto: Partial<CreateQuotationDto>) {
    return this.quotationsService.updateQuotation(id, dto);
  }

  @Public()
  @Delete(":id")
  @ApiOperation({ summary: "Delete quotation by ID" })
  async deleteQuotation(@Param("id") id: string) {
    return this.quotationsService.deleteQuotation(id);
  }

  @Public()
  @Post(":id/convert-to-invoice")
  @ApiOperation({ summary: "Convert quotation to invoice and create POS order" })
  async convertToInvoice(
    @Param("id") id: string,
    @Body() dto: ConvertToInvoiceDto,
  ) {
    return this.quotationsService.convertToInvoice(id, dto);
  }
}
