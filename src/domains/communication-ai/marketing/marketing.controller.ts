import { Controller, Get, Post, Body } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { MarketingService } from "./marketing.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Communication & AI")
@Controller("marketing")
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "List marketing campaigns" })
  async getMarketing() {
    const campaigns = await this.marketingService.getCampaigns();
    return { success: true, campaigns };
  }

  @Public()
  @Get("campaigns")
  @ApiOperation({ summary: "List active marketing campaigns" })
  async getCampaigns() {
    const campaigns = await this.marketingService.getCampaigns();
    return { success: true, campaigns };
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Dispatch marketing broadcast or handle marketing action" })
  async handleMarketingAction(@Body() body: any) {
    if (body.action === "SYNC_ZOHO") {
      return this.marketingService.syncZohoLeads();
    }
    return this.marketingService.createBroadcast(body);
  }

  @Public()
  @Post("sync-zoho")
  @ApiOperation({ summary: "Sync CRM leads with Zoho Campaigns" })
  async syncZoho() {
    return this.marketingService.syncZohoLeads();
  }
}
