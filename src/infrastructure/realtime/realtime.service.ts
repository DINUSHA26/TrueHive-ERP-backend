import { Injectable, Logger } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Pusher = require("pusher");

export const CHANNELS = {
  LIVE_CHAT: "presence-live-chat",
  POS_STOCK: "pos-realtime-stock",
  MARKETING: "marketing-metrics",
  AUDIT: "audit-logs",
} as const;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private pusher: any = null;

  constructor() {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER || "ap2";

    if (appId && key && secret) {
      this.pusher = new Pusher({
        appId,
        key,
        secret,
        cluster,
        useTLS: true,
      });
      this.logger.log(`✅ Pusher Real-time initialized on cluster: ${cluster}`);
    } else {
      this.logger.warn("⚠️ Pusher credentials incomplete; real-time broadcast disabled");
    }
  }

  async broadcast(channel: string, event: string, data: any): Promise<boolean> {
    if (!this.pusher) return false;
    try {
      await this.pusher.trigger(channel, event, data);
      return true;
    } catch (err: any) {
      this.logger.warn(`Pusher broadcast failed (${channel} / ${event}): ${err.message}`);
      return false;
    }
  }

  async broadcastChat(event: string, data: any) {
    return this.broadcast(CHANNELS.LIVE_CHAT, event, data);
  }

  async broadcastStock(event: string, data: any) {
    return this.broadcast(CHANNELS.POS_STOCK, event, data);
  }
}
