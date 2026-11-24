import { Controller, Get, Post, Patch, Body } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Public } from "@/common/decorators/roles.decorator";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import * as bcrypt from "bcryptjs";

let memorySettings = {
  businessName: "Fashion Dora (Pvt) Ltd",
  currency: "LKR",
  country: "Sri Lanka",
  whatsappEnabled: true,
  aiMode: "AUTONOMOUS",
  posReceiptFooter: "Thank you for shopping with Fashion Dora!",
  thermalPrinterWidth: "80mm",
  autoDeductBomOnProcessing: true,
  autoSendOrderStatusWhatsApp: true,
};

@ApiTags("Settings")
@Controller("settings")
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Get system configuration settings" })
  async getSettings() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      settings: memorySettings,
      users,
      roles: ["SUPER_ADMIN", "MANAGER", "CASHIER_POS", "SUPPORT_AGENT", "INVENTORY_STAFF", "ACCOUNTANT"],
    };
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Save or update system configuration settings / staff" })
  async saveSettings(@Body() body: any) {
    if (body.action === "CREATE_STAFF") {
      const email = String(body.email || "").toLowerCase().trim();
      const name = String(body.name || "Staff Member").trim();
      const role = body.role || "CASHIER_POS";
      const rawPass = body.password || "TrueHive#Staff@2026";

      const hashFn = (bcrypt as any).hash || (bcrypt as any).default?.hash;
      const passwordHash = await hashFn(rawPass, 10);

      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        const updated = await this.prisma.user.update({
          where: { id: existing.id },
          data: { name, role, isActive: true },
        });
        return { success: true, user: updated, message: "Staff user updated" };
      }

      const user = await this.prisma.user.create({
        data: {
          name,
          email,
          role,
          passwordHash,
          isActive: true,
          permissions: ["DASHBOARD"],
        },
      });

      return { success: true, user, message: "Staff user created successfully" };
    }

    memorySettings = { ...memorySettings, ...(body?.settings || body) };
    return {
      success: true,
      settings: memorySettings,
    };
  }

  @Public()
  @Patch()
  @ApiOperation({ summary: "Patch system configuration settings" })
  async patchSettings(@Body() body: any) {
    memorySettings = { ...memorySettings, ...(body?.settings || body) };
    return {
      success: true,
      settings: memorySettings,
    };
  }
}
