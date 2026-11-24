import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookieParser = require("cookie-parser");

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://mybussiness.vercel.app",
        /\.vercel\.app$/,
        /\.amplifyapp\.com$/,
      ],
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-admin-key"],
    },
  });

  // Global Prefix (excluding root '/' for Lightsail / Load Balancer health checks)
  app.setGlobalPrefix("api/v1", {
    exclude: ["/"],
  });

  // Middlewares & High-Capacity Body Parser for Images / Base64
  app.use(json({ limit: "50mb" }));
  app.use(urlencoded({ extended: true, limit: "50mb" }));
  app.use(cookieParser());

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      forbidNonWhitelisted: false,
    })
  );

  // Enable graceful shutdown for Kubernetes / Docker / AWS ECS
  app.enableShutdownHooks();

  // Swagger OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle("TrueHive ERP & CRM Enterprise API")
    .setDescription("Enterprise-grade Modular Backend Engine for TrueHive ERP, CRM, and WhatsApp AI Automation")
    .setVersion("1.0.0")
    .addBearerAuth()
    .addTag("Health", "AWS Load Balancer Health Monitoring")
    .addTag("IAM", "Authentication & Role-Based Access Control")
    .addTag("WhatsApp", "Meta WhatsApp Cloud API Webhooks & Outbound")
    .addTag("CRM", "Customer Management, Leads, and Real-time Chats")
    .addTag("Commerce", "POS, Products, Inventory, and Orders")
    .addTag("Finance", "Transactions, Invoices, and Financial Sync")
    .addTag("HRM", "Employees, Attendance, Leaves, and Payroll")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "TrueHive ERP Swagger Docs",
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`🚀 TrueHive ERP Backend running on: http://localhost:${port}/api/v1`);
  logger.log(`📚 Swagger Documentation active at: http://localhost:${port}/api/docs`);
}

bootstrap();
