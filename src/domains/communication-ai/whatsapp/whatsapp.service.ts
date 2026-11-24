import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import { RedisService } from "@/infrastructure/redis/redis.service";
import { RealtimeService } from "@/infrastructure/realtime/realtime.service";
import { AiAgentService } from "../ai-agent/ai-agent.service";

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  private get accessToken() {
    return process.env.WHATSAPP_ACCESS_TOKEN || "";
  }
  private get phoneNumberId() {
    return process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  }
  private get apiVersion() {
    return process.env.WHATSAPP_API_VERSION || "v21.0";
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly aiAgent: AiAgentService,
  ) {}

  /**
   * Normalize Sri Lankan & International phone numbers (e.g. 0765731249 -> 94765731249)
   */
  private normalizePhone(phone: string): string {
    const digits = (phone || "").replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) {
      return `94${digits.slice(1)}`;
    }
    if (digits.length === 9 && digits.startsWith("7")) {
      return `94${digits}`;
    }
    return digits;
  }

  /**
   * Split a long or multi-part reply into 2-3 clean, well-structured WhatsApp message bubbles
   * so the customer NEVER sees a cramped wall of text or WhatsApp's "Read more..." truncation!
   */
  private splitIntoCleanBubbles(rawText: string): string[] {
    if (!rawText) return [];

    // 1. Format dense inline bullets so each bullet starts cleanly on its own line
    const normalized = rawText
      .replace(/\r\n/g, "\n")
      .replace(/([^\n])\s*•\s+/g, "$1\n• ")
      .trim();

    // 2. If the AI explicitly used ---BUBBLE--- delimiter, split by it first
    if (/---+\s*BUBBLE\s*---+/i.test(normalized)) {
      const explicitChunks = normalized
        .split(/---+\s*BUBBLE\s*---+/i)
        .map((c) => c.trim())
        .filter(Boolean);
      if (explicitChunks.length > 1) {
        return explicitChunks.slice(0, 4);
      }
    }

    // 3. Do not split official order confirmation receipts (they have box dividers ━━━)
    if (normalized.includes("━━━━━━")) {
      return [normalized];
    }

    // 4. Automatic Smart Splitter if the reply is long (> 480 chars or > 9 lines)
    const lines = normalized.split("\n");
    if (normalized.length <= 480 && lines.length <= 9) {
      return [normalized];
    }

    // Group paragraphs into 2 or 3 balanced bubbles (~380-460 chars per bubble)
    const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

    if (paragraphs.length >= 2) {
      const bubbles: string[] = [];
      let current = "";
      for (const para of paragraphs) {
        if (!current) {
          current = para;
        } else if (
          current.length + para.length + 2 <= 440 &&
          (current.split("\n").length + para.split("\n").length) <= 8
        ) {
          current = `${current}\n\n${para}`;
        } else {
          bubbles.push(current);
          current = para;
        }
      }
      if (current) bubbles.push(current);

      // Cap at 3 bubbles max by merging any trailing small chunks into the 3rd bubble
      if (bubbles.length > 3) {
        return [bubbles[0], bubbles[1], bubbles.slice(2).join("\n\n")];
      }
      return bubbles;
    }

    // Fallback: if it was a single giant paragraph with many single-newline lines, split lines into 2-3 chunks
    const chunkSize = Math.ceil(lines.length / (lines.length > 14 ? 3 : 2));
    const lineBubbles: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      const slice = lines.slice(i, i + chunkSize).join("\n").trim();
      if (slice) lineBubbles.push(slice);
    }
    return lineBubbles.slice(0, 3);
  }

  /**
   * Send WhatsApp Image Message via Meta Cloud API (e.g. Official Product Image with Caption)
   */
  async sendImageMessage(
    toPhone: string,
    imageUrl: string,
    caption?: string
  ): Promise<{ success: boolean; waMessageId: string }> {
    const cleanPhone = this.normalizePhone(toPhone);
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "image",
          image: {
            link: imageUrl,
            ...(caption ? { caption: caption.slice(0, 1000) } : {}),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        this.logger.error(
          `Meta Image Send Error (${res.status}) to ${cleanPhone}: ${JSON.stringify(data)}`
        );
        return { success: false, waMessageId: `mock-img-${Date.now()}` };
      }

      const waMessageId = data.messages?.[0]?.id || `wamid.img.${Date.now()}`;
      return { success: true, waMessageId };
    } catch (err: any) {
      this.logger.error(`Failed to send WhatsApp image message: ${err.message}`);
      return { success: false, waMessageId: `mock-img-err-${Date.now()}` };
    }
  }

  /**
   * Send WhatsApp Message via Meta Cloud API
   */
  async sendMessage(toPhone: string, text: string): Promise<{ success: boolean; waMessageId: string }> {
    const cleanPhone = this.normalizePhone(toPhone);
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "text",
          text: { body: text },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        this.logger.error(`Meta Send Error (${res.status}) to ${cleanPhone}: ${JSON.stringify(data)}`);
        return { success: false, waMessageId: `mock-${Date.now()}` };
      }

      const waMessageId = data.messages?.[0]?.id || `wamid.${Date.now()}`;
      return { success: true, waMessageId };
    } catch (err: any) {
      this.logger.error(`Failed to send WhatsApp message: ${err.message}`);
      return { success: false, waMessageId: `mock-err-${Date.now()}` };
    }
  }

  /**
   * Send Admin WhatsApp Alert to 0765731249 (94765731249).
   * Handles both active 24h window (detailed text message) AND expired 24h window (approved template fallback).
   */
  async sendAdminAlert(
    detailedText: string,
    summaryCustomer = "Customer",
    summaryAction = "New Order / Bank Transfer"
  ): Promise<void> {
    const adminPhone = this.normalizePhone(process.env.WHATSAPP_ADMIN_PHONE || "0765731249");
    if (!adminPhone) return;

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    let hasActive24hWindow = false;
    try {
      const adminRoom = await this.prisma.chatRoom.findUnique({
        where: { whatsappPhone: adminPhone },
      });
      if (adminRoom) {
        const lastInbound = await this.prisma.chatMessage.findFirst({
          where: { chatRoomId: adminRoom.id, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
        });
        if (
          lastInbound &&
          Date.now() - new Date(lastInbound.createdAt).getTime() < 23.5 * 3600 * 1000
        ) {
          hasActive24hWindow = true;
        }
      }
    } catch {}

    await this.sendMessage(adminPhone, detailedText);

    if (!hasActive24hWindow) {
      try {
        const tplRes = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: adminPhone,
            type: "template",
            template: {
              name: "truehive_admin_order_alert",
              language: { code: "en_US" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: summaryCustomer.slice(0, 60) },
                    { type: "text", text: summaryAction.slice(0, 120) },
                  ],
                },
              ],
            },
          }),
        });

        if (!tplRes.ok) {
          await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: adminPhone,
              type: "template",
              template: {
                name: "hello_world",
                language: { code: "en_US" },
              },
            }),
          });
        }
      } catch (e: any) {
        this.logger.warn(`Admin template fallback error: ${e.message}`);
      }
    }
  }

  /**
   * Mark incoming WhatsApp message as READ (Blue Ticks) & Trigger Typing Indicator
   */
  async markAsRead(waMessageId: string, showTyping = true): Promise<boolean> {
    if (!waMessageId || waMessageId.startsWith("mock-")) return false;
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    try {
      const payload: Record<string, any> = {
        messaging_product: "whatsapp",
        status: "read",
        message_id: waMessageId,
      };
      if (showTyping) {
        payload.typing_indicator = { type: "text" };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok && showTyping) {
        const fallbackRes = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            status: "read",
            message_id: waMessageId,
          }),
        });
        return fallbackRes.ok;
      }

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Download Inbound WhatsApp Media (Image or Voice Audio) as Base64 + Data URL
   */
  private async fetchWhatsAppMediaBinary(
    mediaId: string
  ): Promise<{ base64: string; mimeType: string; dataUrl: string } | null> {
    if (!mediaId || !this.accessToken) return null;
    try {
      const metaRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(3500),
      });
      if (!metaRes.ok) return null;
      const metaData = await metaRes.json();
      const mediaUrl = metaData?.url;
      const mimeType = metaData?.mime_type || "application/octet-stream";
      if (!mediaUrl) return null;

      const binRes = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(4500),
      });
      if (!binRes.ok) return null;
      const arrayBuf = await binRes.arrayBuffer();
      if (arrayBuf.byteLength > 2.5 * 1024 * 1024) return null;
      const base64 = Buffer.from(arrayBuf).toString("base64");
      return {
        base64,
        mimeType,
        dataUrl: `data:${mimeType};base64,${base64}`,
      };
    } catch (e: any) {
      this.logger.warn(`Failed to download WhatsApp media ${mediaId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Download Inbound WhatsApp Media (e.g. Bank Transfer Slip Image) as Base64 Data URL for CRM Display
   */
  private async fetchWhatsAppMediaDataUrl(mediaId: string): Promise<string | null> {
    const res = await this.fetchWhatsAppMediaBinary(mediaId);
    return res ? res.dataUrl : null;
  }

  /**
   * Ultra-Fast Inbound Message Processor
   * Runs Meta Read/Typing, DB Persistence, and Gemini AI Generation in parallel for ~1s end-to-end replies!
   */
  async processInboundMessage(params: {
    customerPhone: string;
    customerName: string;
    messageText: string;
    waMessageId: string;
    messageType?: "TEXT" | "AUDIO" | "IMAGE";
    mediaId?: string;
  }) {
    const {
      customerPhone,
      customerName,
      messageText,
      waMessageId,
      messageType = "TEXT",
      mediaId = "",
    } = params;

    // 1. Fire Read Receipt + Typing Indicator immediately (non-blocking so we save ~350ms!)
    this.markAsRead(waMessageId, true).catch(() => {});

    // 2. Fast Idempotency Check
    const isFirstTime = await this.redis.markWebhookProcessed(waMessageId);
    if (!isFirstTime) {
      this.logger.log(`Duplicate webhook ignored: ${waMessageId}`);
      return { status: "duplicate_ignored" };
    }

    let combinedText = messageText;

    // SPECIAL RULE: If Customer Uploads an Image / Bank Transfer Slip -> DO NOT auto-approve!
    if (messageType === "IMAGE") {
      const [dataUrl, existingCustomer, existingRoom] = await Promise.all([
        mediaId ? this.fetchWhatsAppMediaDataUrl(mediaId) : Promise.resolve(null),
        this.prisma.customer.findUnique({ where: { phone: customerPhone } }),
        this.prisma.chatRoom.findUnique({
          where: { whatsappPhone: customerPhone },
          include: {
            messages: {
              where: { direction: "INBOUND", messageType: "TEXT" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        }),
      ]);

      if (dataUrl) {
        const caption =
          combinedText && !combinedText.startsWith("[")
            ? combinedText
            : "Bank Transfer Slip / Image Attachment (Awaiting Staff Verification)";
        combinedText = `📎 [IMAGE: Payment_Slip.jpg]\n${dataUrl}\n${caption}`;
      }

      const prevText = existingRoom?.messages?.[0]?.content || "";
      const isSinhalaOrSinglish =
        /[\u0D80-\u0DFF]/.test(prevText) ||
        /\b(kiyada|monada|kohomada|ganna|one|eka|mata|ewanna)\b/i.test(prevText);

      const slipHoldReply = isSinhalaOrSinglish
        ? `ස්තූතියි ${customerName}! ඔබ එවූ බැංකු ගෙවීම් රිසිට්පත / ඡායාරූපය අප වෙත ලැබුණා. ⏳\n\nබැංකු තැන්පතු (Bank Transfer) ස්වයංක්‍රීයව අනුමත නොවන අතර, අපගේ කාර්ය මණ්ඩලයේ නිලධාරියෙකු විසින් එය පරීක්ෂා කර අනුමත කිරීමෙන් පසුව පමණක් ඔබගේ ඇණවුම තහවුරු කරනු ලැබේ. අපගේ නිලධාරියෙකු දැන් එය පරීක්ෂා කර ඉක්මනින්ම ඔබට දැනුම් දෙනු ඇත!`
        : `Thank you ${customerName}! We have received your uploaded payment slip / image. ⏳\n\nPlease note that Bank Transfer payments are NOT automatically approved — one of our staff members will manually review and verify your payment slip before confirming your order. Our team has been notified and will update you shortly!`;

      // Send reply to customer immediately while saving to DB in parallel
      const sendHoldPromise = this.sendMessage(customerPhone, slipHoldReply);

      const customer =
        existingCustomer ||
        (await this.prisma.customer.create({
          data: { name: customerName, phone: customerPhone, whatsappId: customerPhone },
        }));

      const chatRoom = existingRoom
        ? await this.prisma.chatRoom.update({
            where: { id: existingRoom.id },
            data: {
              customerName,
              unreadCount: { increment: 1 },
              lastMessageText: slipHoldReply,
              lastMessageAt: new Date(),
            },
          })
        : await this.prisma.chatRoom.create({
            data: {
              customerId: customer.id,
              whatsappPhone: customerPhone,
              customerName,
              isAiActive: true,
              handoverStatus: "AI_ACTIVE",
              unreadCount: 1,
              lastMessageText: slipHoldReply,
            },
          });

      const sendHoldRes = await sendHoldPromise;

      await Promise.all([
        this.prisma.chatMessage.create({
          data: {
            chatRoomId: chatRoom.id,
            waMessageId,
            direction: "INBOUND",
            senderType: "CUSTOMER",
            messageType,
            content: combinedText,
          },
        }),
        this.prisma.chatMessage.create({
          data: {
            chatRoomId: chatRoom.id,
            waMessageId: sendHoldRes.waMessageId,
            direction: "OUTBOUND",
            senderType: "AI_BOT",
            messageType: "TEXT",
            content: slipHoldReply,
            aiToolCalls: ["bank_transfer_manual_review_hold"],
          },
        }),
        this.realtime.broadcastChat("message-sent", {
          chatRoomId: chatRoom.id,
          phone: customerPhone,
          customerName,
          message: slipHoldReply,
          direction: "OUTBOUND",
        }),
        this.sendAdminAlert(
          `🏦 *[TrueHive Bank Transfer Verification Required]*\nCustomer: ${customerName} (+${customerPhone})\nAction: Uploaded a Bank Transfer Slip / Image on WhatsApp.\nStatus: Awaiting Manual Staff Verification & Approval.\n👉 Please open TrueHive CRM Live Chat to inspect the slip and approve the order:\nhttps://main.d37dp08oxfbpii.amplifyapp.com/chats`,
          `${customerName} (+${customerPhone})`,
          "Bank Transfer Slip Uploaded (Awaiting Staff Approval)"
        ),
      ]);

      return {
        success: true,
        sentToWhatsApp: sendHoldRes.success,
        waMessageId: sendHoldRes.waMessageId,
        replyText: slipHoldReply,
        tools: ["bank_transfer_manual_review_hold"],
      };
    }

    // 3. PARALLEL EXECUTION FOR TEXT & VOICE (AUDIO) MESSAGES:
    // If messageType === "AUDIO", download the voice note binary first so Gemini can listen & transcribe it!
    let audioBinary: { base64: string; mimeType: string; dataUrl: string } | null = null;
    if (messageType === "AUDIO" && mediaId) {
      audioBinary = await this.fetchWhatsAppMediaBinary(mediaId);
    }

    const aiTask = this.aiAgent.runAgenticLoop({
      customerPhone,
      customerName,
      incomingMessage: combinedText,
      messageType,
      audioBase64: audioBinary?.base64,
      audioMimeType: audioBinary?.mimeType,
    });

    const saveCustomerAndRoomTask = (async () => {
      let customer = await this.prisma.customer.findUnique({ where: { phone: customerPhone } });
      if (!customer) {
        customer = await this.prisma.customer.create({
          data: { name: customerName, phone: customerPhone, whatsappId: customerPhone },
        });
      }

      let chatRoom = await this.prisma.chatRoom.findUnique({
        where: { whatsappPhone: customerPhone },
      });
      if (!chatRoom) {
        chatRoom = await this.prisma.chatRoom.create({
          data: {
            customerId: customer.id,
            whatsappPhone: customerPhone,
            customerName,
            isAiActive: true,
            handoverStatus: "AI_ACTIVE",
            unreadCount: 1,
            lastMessageText: combinedText,
          },
        });
      } else {
        chatRoom = await this.prisma.chatRoom.update({
          where: { id: chatRoom.id },
          data: {
            customerName,
            unreadCount: { increment: 1 },
            lastMessageText: combinedText,
            lastMessageAt: new Date(),
          },
        });
      }

      return chatRoom;
    })();

    const [chatRoom, aiResult] = await Promise.all([saveCustomerAndRoomTask, aiTask]);

    // Format inbound content (if voice note, include playable audio dataUrl + transcribed text for CRM Chat View)
    if (messageType === "AUDIO") {
      const transcriptLabel = aiResult.voiceTranscript
        ? `🎤 "${aiResult.voiceTranscript}"`
        : "🎤 [Voice Message Received]";
      combinedText = audioBinary?.dataUrl
        ? `📎 [AUDIO: Voice_Message.ogg]\n${audioBinary.dataUrl}\n${transcriptLabel}`
        : transcriptLabel;
    }

    // Save inbound message and broadcast to CRM Live Chat
    this.prisma.chatMessage
      .create({
        data: {
          chatRoomId: chatRoom.id,
          waMessageId,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          messageType,
          content: combinedText,
        },
      })
      .then(() => {
        this.realtime
          .broadcastChat("message-received", {
            chatRoomId: chatRoom.id,
            phone: customerPhone,
            customerName,
            message: combinedText,
            direction: "INBOUND",
            isAiActive: chatRoom.isAiActive,
          })
          .catch(() => {});
      })
      .catch(() => {});

    // If AI was paused by staff (Staff Mode), don't send the AI reply
    if (!chatRoom.isAiActive) {
      return {
        success: true,
        aiPaused: true,
        message: "Chat in Human Handover mode.",
      };
    }

    // 4. Split reply into 1 to 3 clean, structured WhatsApp bubbles (avoiding "Read more" truncation!)
    const replyBubbles = this.splitIntoCleanBubbles(aiResult.replyText);
    const sentBubbles: Array<{
      text: string;
      crmContent: string;
      msgType: "TEXT" | "IMAGE";
      mediaUrl?: string;
      waMessageId: string;
      success: boolean;
    }> = [];

    for (let i = 0; i < replyBubbles.length; i++) {
      const bubbleText = replyBubbles[i];

      // If this inquiry is about a specific product, send the FIRST bubble as an official WhatsApp Image Message (Product Photo + Bubble 1 Caption)!
      if (i === 0 && aiResult.productMediaCard?.imageUrl) {
        const imgUrl = aiResult.productMediaCard.imageUrl;
        const imgRes = await this.sendImageMessage(customerPhone, imgUrl, bubbleText);
        if (imgRes.success) {
          const crmImgContent = `📎 [IMAGE: ${aiResult.productMediaCard.name}]\n${imgUrl}\n${bubbleText}`;
          sentBubbles.push({
            text: bubbleText,
            crmContent: crmImgContent,
            msgType: "IMAGE",
            mediaUrl: imgUrl,
            waMessageId: imgRes.waMessageId,
            success: true,
          });
          continue;
        }
      }

      const res = await this.sendMessage(customerPhone, bubbleText);
      sentBubbles.push({
        text: bubbleText,
        crmContent: bubbleText,
        msgType: "TEXT",
        waMessageId: res.waMessageId,
        success: res.success,
      });
    }

    const lastBubble = sentBubbles[sentBubbles.length - 1] || {
      text: aiResult.replyText,
      crmContent: aiResult.replyText,
      msgType: "TEXT" as const,
      waMessageId: `wamid.${Date.now()}`,
      success: false,
    };

    // 5. Persist outbound message bubble(s), broadcast to CRM dashboard, and send Admin alerts concurrently
    await Promise.all([
      (async () => {
        for (const b of sentBubbles) {
          await this.prisma.chatMessage.create({
            data: {
              chatRoomId: chatRoom.id,
              waMessageId: b.waMessageId,
              direction: "OUTBOUND",
              senderType: "AI_BOT",
              messageType: b.msgType,
              content: b.crmContent,
              mediaUrl: b.mediaUrl,
              aiToolCalls: aiResult.executedTools,
            },
          });
        }
      })(),
      this.prisma.chatRoom.update({
        where: { id: chatRoom.id },
        data: {
          lastMessageText: lastBubble.text,
          lastMessageAt: new Date(),
        },
      }),
      (async () => {
        for (const b of sentBubbles) {
          await this.realtime
            .broadcastChat("message-sent", {
              chatRoomId: chatRoom.id,
              phone: customerPhone,
              customerName,
              message: b.crmContent,
              direction: "OUTBOUND",
              tools: aiResult.executedTools,
            })
            .catch(() => {});
        }
      })(),
      (async () => {
        if (aiResult.bankTransferAlert) {
          await this.sendAdminAlert(
            `🏦 *[TrueHive Bank Transfer Order Request]*\nCustomer: ${customerName} (+${customerPhone})\nDetails: ${aiResult.bankTransferAlert}\nStatus: Awaiting Bank Slip & Manual Staff Approval.\n👉 Please check TrueHive CRM Live Chat:\nhttps://main.d37dp08oxfbpii.amplifyapp.com/chats`,
            `${customerName} (+${customerPhone})`,
            `Bank Transfer Order: ${aiResult.bankTransferAlert}`
          );
        } else if (aiResult.createdOrderNumber) {
          await this.sendAdminAlert(
            `🎉 *[TrueHive New Order Alert]*\nOrder #: ${aiResult.createdOrderNumber}\nCustomer: ${customerName} (+${customerPhone})\nDetails: ${aiResult.orderSummary || "Cash on Delivery (COD)"}\n👉 Please check TrueHive CRM Order Management:\nhttps://main.d37dp08oxfbpii.amplifyapp.com/orders`,
            `${customerName} (+${customerPhone})`,
            `New Order #${aiResult.createdOrderNumber} (${aiResult.orderSummary || "COD"})`
          );
        } else if (aiResult.handoverTriggered) {
          await this.sendAdminAlert(
            `🚨 *[TrueHive Staff Assistance Alert]*\nCustomer: ${customerName} (+${customerPhone}) requested human staff assistance on WhatsApp!\nMessage: ${combinedText}\n👉 Open CRM Live Chat:\nhttps://main.d37dp08oxfbpii.amplifyapp.com/chats`,
            `${customerName} (+${customerPhone})`,
            `Requested Human Staff Assistance: ${combinedText}`
          );
        }
      })(),
    ]);

    return {
      success: true,
      sentToWhatsApp: lastBubble.success,
      waMessageId: lastBubble.waMessageId,
      replyText: replyBubbles.join("\n\n"),
      bubblesSent: sentBubbles.length,
      tools: aiResult.executedTools,
    };
  }
}
