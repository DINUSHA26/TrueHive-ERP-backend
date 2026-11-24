import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private memoryStore = new Map<string, { value: string; expiresAt?: number }>();

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn("⚠️ REDIS_URL not set; using In-Memory Fallback store");
      return;
    }
    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        commandTimeout: 2000,
        lazyConnect: true,
      });

      this.client.connect()
        .then(() => this.logger.log("✅ Upstash / Cloud Redis connected successfully"))
        .catch((err) => {
          this.logger.warn(`Redis connection failed (${err.message}). Using In-Memory fallback.`);
          this.client = null;
        });
    } catch (err: any) {
      this.logger.warn(`Failed to initialize Redis (${err.message}). Using In-Memory fallback.`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Prevents duplicate processing of the same WhatsApp message ID (24h TTL)
   */
  async markWebhookProcessed(waMessageId: string): Promise<boolean> {
    const key = `wa:msg:${waMessageId}`;
    if (this.client) {
      try {
        const res = await this.client.set(key, "1", "EX", 86400, "NX");
        return res === "OK";
      } catch {
        // Fall through to memoryStore
      }
    }

    const now = Date.now();
    const existing = this.memoryStore.get(key);
    if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
      return false; // Already processed
    }
    this.memoryStore.set(key, { value: "1", expiresAt: now + 86400 * 1000 });
    return true;
  }

  /**
   * Buffers rapid WhatsApp messages from the same phone number (30s TTL)
   */
  async bufferWhatsAppMessage(phone: string, text: string, ttlSeconds = 30): Promise<string[]> {
    const key = `wa:buffer:${phone}`;
    if (this.client) {
      try {
        await this.client.rpush(key, text);
        await this.client.expire(key, ttlSeconds);
        return await this.client.lrange(key, 0, -1);
      } catch {
        // Fall through to memory
      }
    }

    const existing = this.memoryStore.get(key);
    const list: string[] = existing ? JSON.parse(existing.value) : [];
    list.push(text);
    this.memoryStore.set(key, {
      value: JSON.stringify(list),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return list;
  }

  /**
   * Consumes and clears all buffered WhatsApp messages for a phone number
   */
  async consumeBufferedWhatsAppMessages(phone: string): Promise<string> {
    const key = `wa:buffer:${phone}`;
    if (this.client) {
      try {
        const messages = await this.client.lrange(key, 0, -1);
        await this.client.del(key);
        return messages.join("\n");
      } catch {
        // Fall through
      }
    }

    const existing = this.memoryStore.get(key);
    this.memoryStore.delete(key);
    if (!existing) return "";
    const list: string[] = JSON.parse(existing.value);
    return list.join("\n");
  }

  /**
   * Generic Cache Helpers
   */
  async get(key: string): Promise<string | null> {
    if (this.client) {
      try {
        return await this.client.get(key);
      } catch {
        // Fallback
      }
    }
    const item = this.memoryStore.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.memoryStore.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, "EX", ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch {
        // Fallback
      }
    }
    this.memoryStore.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      try {
        await this.client.del(key);
        return;
      } catch {
        // Fallback
      }
    }
    this.memoryStore.delete(key);
  }

  async setLiveStock(sku: string, stock: number): Promise<void> {
    return this.set(`stock:${sku}`, String(stock), 3600);
  }

  async getLiveStock(sku: string): Promise<number | null> {
    const val = await this.get(`stock:${sku}`);
    return val !== null ? Number(val) : null;
  }
}
