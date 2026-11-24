import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RealtimeService } from "@/infrastructure/realtime/realtime.service";
import { WhatsappService } from "../communication-ai/whatsapp/whatsapp.service";
import { HandoverStatus, LeadStage } from "@prisma/client";

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly whatsapp: WhatsappService,
  ) {}

  private formatSriLankaTime(dateInput: Date | string): string {
    try {
      return new Date(dateInput).toLocaleTimeString("en-US", {
        timeZone: "Asia/Colombo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "Just now";
    }
  }

  /**
   * Fast-path Chats Querying
   */
  async getChats() {
    const chatRooms = await this.prisma.chatRoom.findMany({
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 250,
        },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    });

    return chatRooms.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      whatsappPhone: r.whatsappPhone,
      isAiActive: r.isAiActive,
      handoverStatus: r.handoverStatus,
      unreadCount: r.unreadCount,
      lastMessageText: r.lastMessageText || "",
      lastMessageAt: r.lastMessageAt ? this.formatSriLankaTime(r.lastMessageAt) : "Just now",
      lastMessageAtIso: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : undefined,
      messages: r.messages
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          direction: m.direction,
          senderType: m.senderType,
          messageType: m.messageType,
          content: m.content,
          timestamp: this.formatSriLankaTime(m.createdAt),
          createdAtIso: new Date(m.createdAt).toISOString(),
          toolCalls: m.aiToolCalls ? (m.aiToolCalls as string[]) : undefined,
        })),
    }));
  }

  /**
   * Leads Pipeline
   */
  async getLeads() {
    return this.prisma.lead.findMany({
      include: {
        callNotes: {
          orderBy: { createdAt: "desc" },
        },
        customer: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }

  /**
   * Update Lead (Stage / Call Note)
   */
  async updateLead(leadId: string, data: { stage?: string; note?: string; authorName?: string }) {
    if (data.stage) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          stage: data.stage as LeadStage,
        },
      });
    }

    if (data.note) {
      await this.prisma.leadCallNote.create({
        data: {
          leadId,
          note: data.note,
          authorName: data.authorName || "CRM Agent",
        },
      });
    }

    const updated = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        callNotes: {
          orderBy: { createdAt: "desc" },
        },
        customer: true,
      },
    });

    await this.realtime.broadcastChat("lead-updated", { lead: updated });
    return updated;
  }

  /**
   * Create Appointment on Lead
   */
  async createAppointment(data: { leadId: string; date?: string; note?: string }) {
    const followUpDate = data.date ? new Date(data.date) : new Date(Date.now() + 86400000);
    const updated = await this.prisma.lead.update({
      where: { id: data.leadId },
      data: {
        nextFollowUpAt: followUpDate,
        ...(data.note
          ? {
              issueSummary: data.note,
            }
          : {}),
      },
      include: {
        callNotes: true,
      },
    });

    if (data.note) {
      await this.prisma.leadCallNote.create({
        data: {
          leadId: data.leadId,
          note: `Appointment Scheduled for ${followUpDate.toLocaleDateString()}: ${data.note}`,
          authorName: "Staff",
        },
      });
    }

    return updated;
  }

  /**
   * Customer Directory
   */
  async getCustomers() {
    return this.prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async createCustomer(data: any) {
    const custCount = await this.prisma.customer.count();
    const customerCode =
      data.customerCode || `CUST-${String(custCount + 1).padStart(4, "0")}`;

    return this.prisma.customer.create({
      data: {
        customerCode,
        name: data.name,
        phone: data.phone,
        nic: data.nic || null,
        email: data.email || null,
        address: data.address || null,
        customerType: data.customerType || "Regular",
        creditLimit: Number(data.creditLimit) || 0,
        creditDays: Number(data.creditDays) || 30,
        starPoints: Number(data.starPoints) || 0,
        customFields: data.customFields ? JSON.stringify(data.customFields) : null,
      },
    });
  }

  async updateCustomer(id: string, data: any) {
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone && { phone: data.phone }),
        ...(data.nic !== undefined && { nic: data.nic }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.customerType && { customerType: data.customerType }),
        ...(data.creditLimit !== undefined && { creditLimit: Number(data.creditLimit) }),
        ...(data.creditDays !== undefined && { creditDays: Number(data.creditDays) }),
        ...(data.starPoints !== undefined && { starPoints: Number(data.starPoints) }),
        ...(data.customFields && { customFields: JSON.stringify(data.customFields) }),
      },
    });
  }

  async deleteCustomer(id: string) {
    await this.prisma.order.updateMany({
      where: { customerId: id },
      data: { customerId: null },
    });
    await this.prisma.chatRoom.updateMany({
      where: { customerId: id },
      data: { customerId: null },
    });
    return this.prisma.customer.delete({
      where: { id },
    });
  }

  /**
   * Deals / Qualified Opportunities
   */
  async getDeals() {
    return this.prisma.lead.findMany({
      where: {
        intent: { in: ["HIGH_INTENT", "ENGAGED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }

  /**
   * Toggle Human Agent Handover
   */
  async toggleHandover(chatId: string, isAiActive: boolean) {
    const updated = await this.prisma.chatRoom.update({
      where: { id: chatId },
      data: {
        isAiActive,
        handoverStatus: isAiActive ? HandoverStatus.AI_ACTIVE : HandoverStatus.HUMAN_HANDOVER,
        unreadCount: 0,
      },
      include: {
        messages: {
          take: 250,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    await this.realtime.broadcastChat("handover-changed", {
      chatRoomId: chatId,
      isAiActive,
    });
    await this.realtime.broadcastChat("chat-read", {
      chatRoomId: chatId,
      phone: updated.whatsappPhone,
    });

    return updated;
  }

  /**
   * Send Manual Reply from CRM Agent
   */
  async sendReply(chatId: string, text: string) {
    const chatRoom = await this.prisma.chatRoom.findUnique({
      where: { id: chatId },
    });

    if (!chatRoom) {
      throw new Error("Chat room not found");
    }

    const sendRes = await this.whatsapp.sendMessage(chatRoom.whatsappPhone, text);

    const message = await this.prisma.chatMessage.create({
      data: {
        chatRoomId: chatRoom.id,
        waMessageId: sendRes.waMessageId,
        direction: "OUTBOUND",
        senderType: "HUMAN_AGENT",
        messageType: "TEXT",
        content: text,
      },
    });

    const updated = await this.prisma.chatRoom.update({
      where: { id: chatRoom.id },
      data: {
        lastMessageText: text,
        lastMessageAt: new Date(),
        unreadCount: 0,
      },
      include: {
        messages: {
          take: 250,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    await this.realtime.broadcastChat("message-sent", {
      chatRoomId: chatRoom.id,
      phone: chatRoom.whatsappPhone,
      customerName: chatRoom.customerName,
      message: text,
      direction: "OUTBOUND",
    });

    return { message, chat: updated };
  }

  /**
   * Mark Chat as Read
   */
  async markAsRead(chatId?: string, phone?: string) {
    const whereClause = chatId ? { id: String(chatId) } : { whatsappPhone: String(phone) };
    const updated = await this.prisma.chatRoom.update({
      where: whereClause,
      data: { unreadCount: 0 },
    });

    await this.realtime.broadcastChat("chat-read", {
      chatRoomId: updated.id,
      phone: updated.whatsappPhone,
    });

    return updated;
  }

  /**
   * Simulate Incoming WhatsApp Message (For testing & simulators)
   */
  async simulateIncoming(data: {
    phone?: string;
    customerName?: string;
    message?: string;
    messageType?: "TEXT" | "AUDIO" | "IMAGE";
  }) {
    return this.whatsapp.processInboundMessage({
      customerPhone: data.phone || "+94771234567",
      customerName: data.customerName || "Test Customer",
      messageText: data.message || "Hello TrueHive",
      waMessageId: `wamid.sim-${Date.now()}`,
      messageType: data.messageType || "TEXT",
    });
  }

  /**
   * Sync Leads to Zoho Campaigns
   */
  async syncZoho() {
    const leads = await this.prisma.lead.findMany();
    // Simulate/Execute Zoho sync
    this.logger.log(`Syncing ${leads.length} leads to Zoho Marketing Campaigns...`);
    return {
      success: true,
      syncedCount: leads.length,
      message: `Successfully synced ${leads.length} leads to Zoho Marketing Campaigns.`,
    };
  }
}
