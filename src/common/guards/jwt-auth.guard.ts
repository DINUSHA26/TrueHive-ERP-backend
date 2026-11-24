import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { IS_PUBLIC_KEY } from "../decorators/roles.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwtSecret =
    process.env.JWT_SECRET || "truehive-super-secret-jwt-key-change-in-production-2026";

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const cookieToken = request.cookies?.["truehive_auth_token"];

    let token = "";
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      throw new UnauthorizedException("Authentication token missing");
    }

    try {
      const verifyFn = (jwt as any).verify || (jwt as any).default?.verify;
      const decoded = verifyFn(token, this.jwtSecret) as any;
      request.user = {
        id: decoded.id || decoded.sub,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired authentication token");
    }
  }
}
