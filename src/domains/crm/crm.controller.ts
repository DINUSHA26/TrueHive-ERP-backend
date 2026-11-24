import { Controller, Get, Post, Query, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CrmService } from "./crm.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("CRM")
@Controller("crm")
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Public() // Allow dashboard queries seamlessly
  @Get()
  @ApiOperation({ summary: "Get CRM views (chats, leads, customers, deals)" })
  async getView(@Query("view") view?: string) {
    if (view === "chats") {
      const chats = await this.crmService.getChats();
      return { success: true, chats, chatRooms: chats, totalUnread: chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0) };
    }
    if (view === "leads") {
      const leads = await this.crmService.getLeads();
      return { success: true, leads };
    }
    if (view === "customers") {
      const customers = await this.crmService.getCustomers();
      return { success: true, customers };
    }
    if (view === "deals") {
      const deals = await this.crmService.getDeals();
      return { success: true, deals };
    }

    // Default overview
    const [chats, leads, customers] = await Promise.all([
      this.crmService.getChats(),
      this.crmService.getLeads(),
      this.crmService.getCustomers(),
    ]);

    return {
      success: true,
      chats,
      chatRooms: chats,
      leads,
      customers,
      stats: {
        totalChats: chats.length,
        totalLeads: leads.length,
        totalCustomers: customers.length,
        totalUnread: chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
      },
    };
  }

  @Public()
  @Post()
  @ApiOperation({ summary: "Execute CRM actions" })
  async handleAction(@Body() body: any) {
    const action = body.action || body.type;

    if (action === "TOGGLE_HANDOVER") {
      const updated = await this.crmService.toggleHandover(body.chatId, body.isAiActive);
      return { success: true, updated, chat: updated };
    }

    if (action === "SEND_REPLY" || action === "SEND_HUMAN_REPLY") {
      const text = body.message || body.text || "";
      const res = await this.crmService.sendReply(body.chatId, text);
      return { success: true, ...res };
    }

    if (action === "MARK_AS_READ" || action === "SEEN_CHAT") {
      await this.crmService.markAsRead(body.chatId, body.phone);
      return { success: true };
    }

    if (action === "UPDATE_LEAD") {
      const lead = await this.crmService.updateLead(body.leadId || body.id, {
        stage: body.stage,
        note: body.note,
        authorName: body.authorName,
      });
      return { success: true, lead };
    }

    if (action === "CREATE_APPOINTMENT") {
      const lead = await this.crmService.createAppointment({
        leadId: body.leadId || body.id,
        date: body.followUpTime || body.date,
        note: body.issueSummary || body.note,
      });
      return { success: true, lead };
    }

    if (action === "SYNC_ZOHO") {
      return this.crmService.syncZoho();
    }

    if (action === "SIMULATE_INCOMING") {
      return this.crmService.simulateIncoming(body);
    }

    if (action === "CREATE_CUSTOMER") {
      const customer = await this.crmService.createCustomer(body);
      return { success: true, customer };
    }

    if (action === "UPDATE_CUSTOMER") {
      const customer = await this.crmService.updateCustomer(body.id, body);
      return { success: true, customer };
    }

    if (action === "DELETE_CUSTOMER") {
      await this.crmService.deleteCustomer(body.id);
      return { success: true };
    }

    return { success: false, error: `Unknown CRM action: ${action}` };
  }
}
