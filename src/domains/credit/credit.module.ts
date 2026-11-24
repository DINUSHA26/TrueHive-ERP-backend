import { Module } from "@nestjs/common";
import { CreditController } from "./credit.controller";
import { CreditService } from "./credit.service";
import { DatabaseModule } from "@/infrastructure/database/database.module";
import { RealtimeModule } from "@/infrastructure/realtime/realtime.module";

@Module({
  imports: [DatabaseModule, RealtimeModule],
  controllers: [CreditController],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
