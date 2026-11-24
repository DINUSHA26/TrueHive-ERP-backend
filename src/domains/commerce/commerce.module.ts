import { Module } from "@nestjs/common";
import { PosController } from "./pos/pos.controller";
import { PosService } from "./pos/pos.service";
import { CatalogController } from "./catalog/catalog.controller";
import { CatalogService } from "./catalog/catalog.service";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { OverviewController } from "./overview/overview.controller";
import { OverviewService } from "./overview/overview.service";
import { InventoryController } from "./inventory/inventory.controller";
import { InventoryService } from "./inventory/inventory.service";
import { SuppliersController } from "./suppliers/suppliers.controller";
import { SuppliersService } from "./suppliers/suppliers.service";
import { QuotationsController } from "./quotations/quotations.controller";
import { QuotationsService } from "./quotations/quotations.service";
import { InvoicesController } from "./invoices/invoices.controller";
import { InvoicesService } from "./invoices/invoices.service";
import { SettingsController } from "./settings.controller";
import { ReportsController } from "./reports/reports.controller";

@Module({
  controllers: [
    PosController,
    CatalogController,
    OrdersController,
    OverviewController,
    InventoryController,
    SuppliersController,
    QuotationsController,
    InvoicesController,
    SettingsController,
    ReportsController,
  ],
  providers: [
    PosService,
    CatalogService,
    OrdersService,
    OverviewService,
    InventoryService,
    SuppliersService,
    QuotationsService,
    InvoicesService,
  ],
  exports: [
    PosService,
    CatalogService,
    OrdersService,
    OverviewService,
    InventoryService,
    SuppliersService,
    QuotationsService,
    InvoicesService,
  ],
})
export class CommerceModule {}
