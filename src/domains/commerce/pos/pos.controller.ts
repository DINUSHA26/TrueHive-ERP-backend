import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PosService, PosCheckoutDto } from "./pos.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("pos")
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Public()
  @Post("checkout")
  @ApiOperation({ summary: "POS Atomic Billing, Receipt Generation & Real-time Stock Deduction" })
  async checkout(@Body() dto: PosCheckoutDto) {
    return this.posService.checkout(dto);
  }
}
