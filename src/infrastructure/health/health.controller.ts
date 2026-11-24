import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { PrismaService } from "../database/prisma.service";
import { RedisService } from "../redis/redis.service";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: "AWS Load Balancer & Kubernetes Health Check Probe" })
  async check() {
    let dbStatus = "UP";
    let redisStatus = "UP";

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = "DOWN";
    }

    try {
      const client = this.redis.getClient();
      if (client && client.status === "ready") {
        redisStatus = "UP";
      } else {
        redisStatus = "IN_MEMORY_FALLBACK";
      }
    } catch {
      redisStatus = "DOWN";
    }

    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();

    return {
      status: dbStatus === "UP" ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      },
    };
  }
}
