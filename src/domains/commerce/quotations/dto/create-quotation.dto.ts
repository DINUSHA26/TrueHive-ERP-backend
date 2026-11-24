import { IsString, IsOptional, IsNumber, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class QuotationItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ default: "Pcs" })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ default: 1 })
  @IsNumber()
  quantity: number;

  @ApiProperty({ default: 0 })
  @IsNumber()
  unitPrice: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  taxPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class CreateQuotationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quoteNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty()
  @IsString()
  clientName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectDesc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleNo?: string;

  @ApiPropertyOptional({ default: "Fashion dora" })
  @IsOptional()
  @IsString()
  preparedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  taxPercent?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  amountPaid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amountInWords?: string;

  @ApiProperty({ type: [QuotationItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items: QuotationItemDto[];
}

export class ConvertToInvoiceDto {
  @ApiPropertyOptional({ default: "Cash" })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountPaid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
