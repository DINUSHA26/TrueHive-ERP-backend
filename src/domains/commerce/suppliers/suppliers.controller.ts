import { Controller, Get, Post, Body } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { SuppliersService } from "./suppliers.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Get suppliers, purchase orders, products, and ingredients" })
  async getSuppliers() {
    return this.suppliersService.getSuppliersData();
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Handle Supplier & Purchase Order actions" })
  async handleSupplierAction(@Body() body: any) {
    if (body.action === "CREATE_SUPPLIER") {
      const supplier = await this.suppliersService.createSupplier(body);
      return { success: true, supplier };
    }
    if (body.action === "UPDATE_SUPPLIER") {
      const supplier = await this.suppliersService.updateSupplier(body.id, body);
      return { success: true, supplier };
    }
    if (body.action === "DELETE_SUPPLIER") {
      await this.suppliersService.deleteSupplier(body.id);
      return { success: true };
    }
    if (body.action === "CREATE_PO") {
      const purchaseOrder = await this.suppliersService.createPurchaseOrder(body);
      return { success: true, purchaseOrder };
    }
    if (body.action === "RECEIVE_PO_GRN") {
      const result = await this.suppliersService.receiveGrn(body.poId);
      return result;
    }
    if (body.action === "DELETE_PO") {
      await this.suppliersService.deletePurchaseOrder(body.poId);
      return { success: true };
    }
    if (body.action === "PAY_SUPPLIER") {
      const supplier = await this.suppliersService.paySupplier(body.supplierId, body.amount);
      return { success: true, supplier };
    }
    return { success: false, error: "Unknown action" };
  }
}
