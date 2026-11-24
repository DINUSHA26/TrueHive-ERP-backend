import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { AppController } from "./app.controller";

// Infrastructure
import { DatabaseModule } from "./infrastructure/database/database.module";
import { RedisModule } from "./infrastructure/redis/redis.module";
import { RealtimeModule } from "./infrastructure/realtime/realtime.module";
import { StorageModule } from "./infrastructure/storage/storage.module";
import { HealthModule } from "./infrastructure/health/health.module";

// Domains
import { IamModule } from "./domains/iam/iam.module";
import { CommunicationAiModule } from "./domains/communication-ai/communication-ai.module";
import { CrmModule } from "./domains/crm/crm.module";
import { CommerceModule } from "./domains/commerce/commerce.module";
import { FinanceModule } from "./domains/finance/finance.module";
import { HrmModule } from "./domains/hrm/hrm.module";
import { CreditModule } from "./domains/credit/credit.module";

// Common
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),

    // Global Technical Infrastructure
    DatabaseModule,
    RedisModule,
    RealtimeModule,
    StorageModule,
    HealthModule,

    // Bounded Context Domains
    IamModule,
    CommunicationAiModule,
    CrmModule,
    CommerceModule,
    FinanceModule,
    HrmModule,
    CreditModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
