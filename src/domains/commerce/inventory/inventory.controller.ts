import { Controller, Get, Post, Delete, Body, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { InventoryService } from "./inventory.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Get full inventory: products, BOM ingredients, suppliers, categories" })
  async getInventory() {
    return this.inventoryService.getInventoryData();
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Handle inventory actions (BOM, Ingredients, Restock, Wastage, Products)" })
  async handleInventoryAction(@Body() body: any) {
    return this.inventoryService.handleAction(body);
  }

  @Public()
  @Delete()
  @ApiOperation({ summary: "Delete ingredient or inventory item" })
  async deleteItem(@Query("id") id: string) {
    return this.inventoryService.handleAction({ action: "DELETE_INGREDIENT", id });
  }
}
