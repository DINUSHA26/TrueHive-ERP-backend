import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsEnum } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { InvoiceType, InvoiceStatus } from "@prisma/client";

export class InvoiceItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ default: "pcs" })
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
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalPrice?: number;
}

export class CreateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({ enum: InvoiceType, default: InvoiceType.STANDARD })
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quotationId?: string;

  @ApiProperty()
  @IsString()
  customerName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddress?: string;

  @ApiPropertyOptional({ default: "LKR" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  deliveryFee?: number;

  @ApiPropertyOptional({ default: "CASH" })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  creditBilled?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}

export class RecordInvoicePaymentDto {
  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty({ default: "CASH" })
  @IsString()
  paymentMethod: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class VoidInvoiceDto {
  @ApiProperty()
  @IsString()
  reason: string;
}
