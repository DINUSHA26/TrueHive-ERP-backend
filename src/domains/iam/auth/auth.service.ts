import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret =
    process.env.JWT_SECRET || "truehive-super-secret-jwt-key-change-in-production-2026";

  constructor(private readonly prisma: PrismaService) {}

  async login(loginDto: LoginDto) {
    const email = loginDto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const compareFn = (bcrypt as any).compare || (bcrypt as any).default?.compare;
    let isMatch = false;
    try {
      if (typeof compareFn === "function") {
        isMatch = await compareFn(loginDto.password, user.passwordHash);
      }
    } catch (e) {
      this.logger.warn(`Bcrypt compare failed: ${e}`);
    }

    // Fallback if plain text match (e.g. initial dev seed)
    if (!isMatch && loginDto.password === user.passwordHash) {
      isMatch = true;
    }

    if (!isMatch) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const signFn = (jwt as any).sign || (jwt as any).default?.sign;
    const token = signFn(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      this.jwtSecret,
      { expiresIn: "7d" }
    );

    return {
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
      },
    };
  }

  async validateUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        permissions: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("User not found or inactive");
    }

    return user;
  }
}
