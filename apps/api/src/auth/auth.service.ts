import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Response } from "express";
import { PrismaService } from "../prisma.service";
import { fail } from "../domain/errors";
import { randomToken, sha256 } from "../domain/tokens";
import { SESSION_COOKIE } from "../common/cookies";
import { SpaceType } from "@prisma/client";

export interface RequestUser {
  id: string;
  email: string;
  displayName: string | null;
  sessionId: string;
}

const SESSION_MS = 30 * 24 * 3600 * 1000;

export function setSessionCookie(res: Response, rawToken: string): void {
  res.cookie(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: { email: string; password: string; displayName?: string }) {
    const email = (input.email || "").trim().toLowerCase();
    const password = input.password || "";
    if (!email || !email.includes("@")) fail("VALIDATION_ERROR");
    if (password.length < 8) fail("VALIDATION_ERROR");
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) fail("AUTH_EMAIL_TAKEN");
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: input.displayName?.trim() || email.split("@")[0],
        emailVerified: true,
      },
    });
    await this.prisma.space.create({
      data: {
        type: SpaceType.PERSONAL,
        name: "我的个人空间",
        ownerId: user.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const { rawToken } = await this.createSession(user.id);
    return { rawToken, user: await this.publicUser(user.id) };
  }

  async login(input: { email: string; password: string }) {
    const email = (input.email || "").trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) fail("AUTH_INVALID_CREDENTIALS");
    const ok = await bcrypt.compare(input.password || "", user.passwordHash);
    if (!ok) fail("AUTH_INVALID_CREDENTIALS");
    const { rawToken } = await this.createSession(user.id);
    return { rawToken, user: await this.publicUser(user.id) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async createSession(userId: string, meta?: { userAgent?: string; ip?: string }) {
    const rawToken = randomToken(32);
    const row = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(rawToken),
        userAgent: meta?.userAgent,
        ip: meta?.ip,
        expiresAt: new Date(Date.now() + SESSION_MS),
      },
    });
    return { rawToken, sessionId: row.id };
  }

  async resolveSession(rawToken: string): Promise<RequestUser | null> {
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return {
      id: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      sessionId: row.id,
    };
  }

  async publicUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: { include: { space: true } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      spaces: user.memberships.map((m) => ({
        id: m.space.id,
        name: m.space.name,
        type: m.space.type,
        role: m.role,
      })),
    };
  }

  async requestMagicLink(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    if (!email.includes("@")) fail("VALIDATION_ERROR");
    const raw = randomToken(24);
    await this.prisma.magicLink.create({
      data: {
        email,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const smtp = process.env.SMTP_URL || process.env.SMTP_HOST;
    return {
      sent: Boolean(smtp),
      // Dev-only: token returned when SMTP is not configured so the flow is real and testable.
      token: smtp ? undefined : raw,
    };
  }

  async consumeMagicLink(raw: string) {
    const row = await this.prisma.magicLink.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) fail("AUTH_MAGIC_LINK_INVALID");
    await this.prisma.magicLink.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    let user = await this.prisma.user.findUnique({ where: { email: row.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: row.email, emailVerified: true, displayName: row.email.split("@")[0] },
      });
      await this.prisma.space.create({
        data: {
          type: SpaceType.PERSONAL,
          name: "我的个人空间",
          ownerId: user.id,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });
    }
    const { rawToken } = await this.createSession(user.id);
    return { rawToken, user: await this.publicUser(user.id) };
  }

  oauthStartUrl(provider: string): string {
    const map: Record<string, { id?: string; auth: string; scope: string }> = {
      google: {
        id: process.env.GOOGLE_CLIENT_ID,
        auth: "https://accounts.google.com/o/oauth2/v2/auth",
        scope: "openid email profile",
      },
      github: {
        id: process.env.GITHUB_CLIENT_ID,
        auth: "https://github.com/login/oauth/authorize",
        scope: "user:email",
      },
      microsoft: {
        id: process.env.MICROSOFT_CLIENT_ID,
        auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        scope: "openid email profile",
      },
    };
    const cfg = map[provider];
    if (!cfg || !cfg.id) fail("AUTH_OAUTH_NOT_CONFIGURED");
    const state = randomToken(16);
    const redirect = `${process.env.API_PUBLIC_URL || "http://127.0.0.1:3001"}/auth/oauth/${provider}/callback`;
    const u = new URL(cfg.auth);
    u.searchParams.set("client_id", cfg.id);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", cfg.scope);
    u.searchParams.set("state", state);
    return u.toString();
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      fail("AUTH_INVALID_CREDENTIALS");
    }
    if (next.length < 8) fail("VALIDATION_ERROR");
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 10) },
    });
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
  }
}
