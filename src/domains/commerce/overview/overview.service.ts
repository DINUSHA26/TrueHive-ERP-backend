import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";

@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverviewStats() {
    const [
      totalOrders,
      ordersAggregate,
      pendingOrdersCount,
      totalProducts,
      productsWithLowStock,
      totalCustomers,
      totalLeads,
      chatRooms,
      recentOrders,
      topProducts,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true, totalCogs: true },
        _avg: { totalAmount: true },
      }),
      this.prisma.order.count({ where: { status: "PENDING" } }),
      this.prisma.product.count(),
      this.prisma.product.findMany({
        where: { currentStock: { lte: 10 } },
        select: { id: true },
      }),
      this.prisma.customer.count(),
      this.prisma.lead.count(),
      this.prisma.chatRoom.findMany({
        select: { unreadCount: true, isAiActive: true },
      }),
      this.prisma.order.findMany({
        take: 6,
        orderBy: { createdAt: "desc" },
        include: { items: true },
      }),
      this.prisma.product.findMany({
        take: 5,
        orderBy: { currentStock: "asc" },
      }),
    ]);

    const totalRevenue = ordersAggregate._sum.totalAmount || 0;
    const totalCogs = ordersAggregate._sum.totalCogs || 0;
    const avgOrder = ordersAggregate._avg.totalAmount || 0;
    const unreadChats = chatRooms.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    const escalatedChats = chatRooms.filter((c) => !c.isAiActive).length;

    return {
      success: true,
      stats: {
        totalRevenue,
        totalCogs,
        totalOrders,
        pendingOrdersCount,
        avgOrder: Math.round(avgOrder),
        totalProducts,
        lowStockCount: productsWithLowStock.length,
        totalCustomers,
        totalLeads,
        unreadChats,
        escalatedChats,
      },
      recentOrders,
      topProducts,
    };
  }
}
