import { Controller, Get, Post, Query, Body, Res, HttpStatus, Logger, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { WhatsappService } from "./whatsapp.service";
import { Public } from "@/common/decorators/roles.decorator";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";

@ApiTags("WhatsApp")
@Controller("webhooks/whatsapp")
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly whatsappService: WhatsappService) {}

  /**
   * Meta Hub Challenge Webhook Verification
   */
  @Public()
  @Get()
  @ApiOperation({ summary: "Meta WhatsApp Webhook Verification Challenge" })
  verifyWebhook(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || "d1719eb054dc6b7b6ee5214e15dbeebc565a5f3861606c8f619423d0998fbdfa";

    if (mode === "subscribe" && token === expectedToken) {
      this.logger.log("✅ Meta Webhook challenge verified successfully!");
      return res.status(HttpStatus.OK).send(challenge);
    }

    if (mode === "subscribe") {
      return res.status(HttpStatus.FORBIDDEN).send("Forbidden");
    }

    return res.status(HttpStatus.OK).json({ status: "WhatsApp Webhook Active" });
  }

  /**
   * Meta WhatsApp Webhook Inbound Receiver
   */
  @Public()
  @Post()
  @ApiOperation({ summary: "Handle incoming customer messages & delivery status updates" })
  async handleInbound(@Body() body: any) {
    const value = body.entry?.[0]?.changes?.[0]?.value;

    // Check delivery status
    if (value?.statuses && !value?.messages) {
      return { status: "status_acknowledged" };
    }

    const isMeta = Boolean(value?.messages?.[0]);
    let customerPhone = "";
    let customerName = "WhatsApp Customer";
    let messageText = "";
    let waMessageId = `wamid.${Date.now()}`;
    let messageType: "TEXT" | "AUDIO" | "IMAGE" = "TEXT";
    let mediaId = "";

    if (isMeta) {
      const msg = value.messages[0];
      waMessageId = msg.id;
      customerPhone = msg.from;
      customerName = value.contacts?.[0]?.profile?.name || customerPhone;

      if (msg.type === "text") {
        messageText = msg.text?.body || "";
      } else if (msg.type === "audio") {
        messageType = "AUDIO";
        mediaId = msg.audio?.id || "";
        messageText = "[Voice Note Received]";
      } else if (msg.type === "image") {
        messageType = "IMAGE";
        mediaId = msg.image?.id || "";
        messageText = msg.image?.caption || "[Bank Transfer Slip / Image Attachment Uploaded]";
      } else if (msg.type === "document") {
        messageType = "IMAGE";
        mediaId = msg.document?.id || "";
        messageText = msg.document?.caption || msg.document?.filename || "[Payment Document Uploaded]";
      }
    } else {
      // Simulator or internal testing payload
      customerPhone = String(body.phone || "");
      customerName = String(body.customerName || customerPhone);
      messageText = String(body.message || "");
      messageType = body.messageType || "TEXT";
    }

    if (!customerPhone || !messageText.trim()) {
      return { status: "no_message_content" };
    }

    return this.whatsappService.processInboundMessage({
      customerPhone,
      customerName,
      messageText,
      waMessageId,
      messageType,
      mediaId,
    });
  }

  /**
   * Meta WhatsApp Diagnostics & Configuration Check
   */
  @Public()
  @Get("debug")
  @ApiOperation({ summary: "Check Meta WhatsApp configuration, phone status, and recent messages" })
  async getDebugInfo(@Query("sendTo") sendTo?: string) {
    const rawPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const rawToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const rawWabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
    const apiVersion = process.env.WHATSAPP_API_VERSION || "v21.0";

    let testSendResult: any = null;
    if (sendTo) {
      testSendResult = await this.whatsappService.sendMessage(
        sendTo,
        `[Diagnostics Check]: Cloud API connection verified at ${new Date().toISOString()}`
      );
    }

    return {
      timestamp: new Date().toISOString(),
      environment: {
        rawPhoneId: rawPhoneId ? `${rawPhoneId.slice(0, 4)}...${rawPhoneId.slice(-4)}` : "MISSING",
        tokenLength: rawToken.length,
        tokenConfigured: Boolean(rawToken),
        wabaId: rawWabaId,
        apiVersion,
      },
      testSendResult,
      status: "WhatsApp Cloud API Service Active",
    };
  }

  /**
   * Send WhatsApp Message (For Agents & Automated Alerts)
   */
  @UseGuards(JwtAuthGuard)
  @Post("send")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Send WhatsApp message to a phone number" })
  async sendMessage(@Body() body: { toPhone: string; text: string }) {
    return this.whatsappService.sendMessage(body.toPhone, body.text);
  }
}
