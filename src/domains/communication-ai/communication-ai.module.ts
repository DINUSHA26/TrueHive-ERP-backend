import { Module } from "@nestjs/common";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { AiAgentModule } from "./ai-agent/ai-agent.module";
import { MarketingModule } from "./marketing/marketing.module";

@Module({
  imports: [WhatsappModule, AiAgentModule, MarketingModule],
  exports: [WhatsappModule, AiAgentModule, MarketingModule],
})
export class CommunicationAiModule {}
