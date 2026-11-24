import { Controller, Post, Body, Get, Res, Req } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Response, Request } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { Public } from "@/common/decorators/roles.decorator";
import * as jwt from "jsonwebtoken";

@ApiTags("IAM")
@Controller("auth")
export class AuthController {
  private readonly jwtSecret =
    process.env.JWT_SECRET || "truehive-super-secret-jwt-key-change-in-production-2026";

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @ApiOperation({ summary: "User authentication & JWT token generation" })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(loginDto);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as any,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    };

    // Set cookies for both frontend session names
    res.cookie("truehive_token", result.token, cookieOptions);
    res.cookie("truehive_auth_token", result.token, cookieOptions);

    return result;
  }

  @Public()
  @Post("logout")
  @ApiOperation({ summary: "Clear auth cookie session" })
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie("truehive_token", { path: "/" });
    res.clearCookie("truehive_auth_token", { path: "/" });
    return { success: true, message: "Logged out successfully" };
  }

  @Public()
  @Get("me")
  @ApiOperation({ summary: "Get current authenticated profile & permissions" })
  async getProfile(@Req() req: Request) {
    const authHeader = req.headers.authorization;
    const cookieToken =
      req.cookies?.["truehive_token"] ||
      req.cookies?.["truehive_auth_token"];

    let token = "";
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      return { authenticated: false, user: null };
    }

    try {
      const verifyFn = (jwt as any).verify || (jwt as any).default?.verify;
      const decoded = verifyFn(token, this.jwtSecret) as any;
      const fullUser = await this.authService.validateUserById(decoded.id || decoded.sub);
      return {
        authenticated: true,
        user: {
          id: fullUser.id,
          name: fullUser.name,
          email: fullUser.email,
          role: fullUser.role,
          permissions: fullUser.permissions,
        },
      };
    } catch {
      return { authenticated: false, user: null };
    }
  }
}
