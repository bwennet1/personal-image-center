import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { AuthService, RequestUser } from "../auth/auth.service";
import { fail } from "../domain/errors";
import { readCookie, SESSION_COOKIE } from "./cookies";

export { readCookie, SESSION_COOKIE } from "./cookies";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const token =
      readCookie(req.headers.cookie, SESSION_COOKIE) ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);
    const user = token ? await this.auth.resolveSession(token) : null;
    if (!user) fail("AUTH_REQUIRED");
    req.user = user;
    return true;
  }
}
