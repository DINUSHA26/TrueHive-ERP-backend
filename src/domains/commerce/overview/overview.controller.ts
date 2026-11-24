import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { OverviewService } from "./overview.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("overview")
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Get executive dashboard overview stats & metrics" })
  async getOverview() {
    return this.overviewService.getOverviewStats();
  }
}
