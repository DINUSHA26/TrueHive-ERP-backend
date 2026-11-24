import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { OrdersService } from "./orders.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "List all orders with full items and dashboard statistics" })
  async getOrders() {
    return this.ordersService.getOrdersData();
  }

  @Public()
  @Get(":id")
  @ApiOperation({ summary: "Get order details by ID" })
  async getOrderById(@Param("id") id: string) {
    const order = await this.ordersService.getOrderById(id);
    return { success: Boolean(order), order };
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Create new manual or COD order" })
  async createOrder(@Body() body: any) {
    return this.ordersService.createOrder(body);
  }

  @Public()
  @Patch()
  @ApiOperation({ summary: "Update order status (Body: { orderId, newStatus })" })
  async updateStatusBody(@Body() body: any) {
    const orderId = body.orderId || body.id;
    return this.ordersService.updateOrderStatus(orderId, {
      status: body.newStatus || body.status,
      note: body.note,
      updatedBy: body.updatedBy || "Staff",
    });
  }

  @Public()
  @Patch(":id")
  @ApiOperation({ summary: "Update order status by ID parameter" })
  async updateStatusParam(@Param("id") id: string, @Body() body: any) {
    return this.ordersService.updateOrderStatus(id, {
      status: body.status || body.newStatus,
      note: body.note,
      updatedBy: body.updatedBy || "Staff",
    });
  }

  @Public()
  @Post(":id/shipment")
  @ApiOperation({ summary: "Assign courier partner and tracking waybill" })
  async updateShipment(@Param("id") id: string, @Body() body: any) {
    return this.ordersService.updateShipment(id, body);
  }

  @Public()
  @Post(":id/cod-settle")
  @ApiOperation({ summary: "Settle COD courier remittance with fee deduction" })
  async settleCod(@Param("id") id: string, @Body() body: any) {
    return this.ordersService.settleCod(id, body);
  }

  @Public()
  @Post(":id/verify-payment")
  @ApiOperation({ summary: "Verify bank transfer payment slip" })
  async verifyPayment(@Param("id") id: string, @Body() body: any) {
    return this.ordersService.verifyPayment(id, body);
  }

  @Public()
  @Patch(":id/payment-status")
  @ApiOperation({ summary: "Update order payment status (PAID/UNPAID)" })
  async updatePaymentStatus(@Param("id") id: string, @Body() body: any) {
    return this.ordersService.updatePaymentStatus(id, body.paymentStatus || body.status || "PAID");
  }

  @Public()
  @Post(":id/mark-paid")
  @ApiOperation({ summary: "Mark order as fully paid" })
  async markPaid(@Param("id") id: string) {
    return this.ordersService.updatePaymentStatus(id, "PAID");
  }

  @Public()
  @Delete(":id")
  @ApiOperation({ summary: "Delete order by ID and restore inventory stock" })
  async deleteOrder(@Param("id") id: string) {
    return this.ordersService.deleteOrder(id);
  }
}
