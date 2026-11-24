import { Module } from "@nestjs/common";
import { MarketingController } from "./marketing.controller";
import { MarketingService } from "./marketing.service";
import { WhatsappModule } from "../whatsapp/whatsapp.module";

@Module({
  imports: [WhatsappModule],
  controllers: [MarketingController],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingModule {}
