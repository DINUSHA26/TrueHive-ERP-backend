import { Module } from "@nestjs/common";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { WhatsappModule } from "../communication-ai/whatsapp/whatsapp.module";

@Module({
  imports: [WhatsappModule],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
