import { Injectable } from "@nestjs/common";
import { SpaceRole, SpaceType } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AccessService } from "./access.service";
import { fail } from "../domain/errors";
import { capabilitiesFor } from "../domain/capabilities";

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.spaceMember.findMany({
      where: { userId },
      include: { space: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((m) => ({
      id: m.space.id,
      name: m.space.name,
      type: m.space.type,
      role: m.role,
      capabilities: capabilitiesFor(m.role),
    }));
  }

  async create(userId: string, input: { name?: string; type?: string }) {
    const type = (input.type || "PERSONAL").toUpperCase();
    if (!["PERSONAL", "FAMILY", "TEAM"].includes(type)) fail("VALIDATION_ERROR");
    const name =
      input.name?.trim() ||
      (type === "FAMILY" ? "家庭空间" : type === "TEAM" ? "团队空间" : "个人空间");
    const space = await this.prisma.space.create({
      data: {
        type: type as SpaceType,
        name,
        ownerId: userId,
        members: { create: { userId, role: SpaceRole.OWNER } },
      },
    });
    await this.prisma.auditLog.create({
      data: { spaceId: space.id, actorId: userId, action: "space.create", target: space.id },
    });
    return { id: space.id, name: space.name, type: space.type, role: "OWNER" };
  }

  async get(userId: string, spaceId: string) {
    const member = await this.access.require(userId, spaceId, "view_media");
    return {
      id: member.space.id,
      name: member.space.name,
      type: member.space.type,
      role: member.role,
      keepOriginal: member.space.keepOriginal,
      trashRetentionDays: member.space.trashRetentionDays,
      capabilities: capabilitiesFor(member.role),
    };
  }

  async members(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    const rows = await this.prisma.spaceMember.findMany({
      where: { spaceId },
      include: { user: true },
    });
    return rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      displayName: m.user.displayName,
      role: m.role,
    }));
  }

  async addMember(actorId: string, spaceId: string, email: string, role: string) {
    await this.access.require(actorId, spaceId, "manage_members");
    const r = role.toUpperCase();
    if (!["ADMIN", "EDITOR", "VIEWER"].includes(r)) fail("VALIDATION_ERROR");
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) fail("VALIDATION_ERROR");
    const existing = await this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: user.id } },
    });
    if (existing) return { userId: user.id, role: existing.role };
    const member = await this.prisma.spaceMember.create({
      data: { spaceId, userId: user.id, role: r as SpaceRole },
    });
    await this.prisma.auditLog.create({
      data: { spaceId, actorId, action: "member.add", target: user.id, metadata: { role: r } },
    });
    return { userId: member.userId, role: member.role };
  }

  async updateMember(actorId: string, spaceId: string, targetUserId: string, role: string) {
    await this.access.require(actorId, spaceId, "manage_roles");
    const r = role.toUpperCase();
    if (!["ADMIN", "EDITOR", "VIEWER"].includes(r)) fail("VALIDATION_ERROR");
    const target = await this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: targetUserId } },
    });
    if (!target) fail("SPACE_ACCESS_DENIED");
    if (target.role === "OWNER") fail("SPACE_ACCESS_DENIED");
    await this.prisma.spaceMember.update({
      where: { id: target.id },
      data: { role: r as SpaceRole },
    });
    return { userId: targetUserId, role: r };
  }

  async removeMember(actorId: string, spaceId: string, targetUserId: string) {
    await this.access.require(actorId, spaceId, "manage_members");
    const target = await this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: targetUserId } },
    });
    if (!target) fail("SPACE_ACCESS_DENIED");
    if (target.role === "OWNER") fail("SPACE_LAST_OWNER");
    await this.prisma.spaceMember.delete({ where: { id: target.id } });
    return { ok: true };
  }

  async deleteSpace(actorId: string, spaceId: string) {
    await this.access.require(actorId, spaceId, "delete_space");
    await this.prisma.auditLog.create({
      data: { spaceId, actorId, action: "space.delete", target: spaceId },
    });
    await this.prisma.space.delete({ where: { id: spaceId } });
    return { ok: true };
  }

  async transfer(actorId: string, spaceId: string, newOwnerId: string) {
    await this.access.require(actorId, spaceId, "transfer_ownership");
    await this.prisma.$transaction(async (tx) => {
      const next = await tx.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId, userId: newOwnerId } },
      });
      if (!next) fail("SPACE_ACCESS_DENIED");
      await tx.spaceMember.update({
        where: { spaceId_userId: { spaceId, userId: actorId } },
        data: { role: SpaceRole.ADMIN },
      });
      await tx.spaceMember.update({
        where: { spaceId_userId: { spaceId, userId: newOwnerId } },
        data: { role: SpaceRole.OWNER },
      });
      await tx.space.update({ where: { id: spaceId }, data: { ownerId: newOwnerId } });
    });
    return { ok: true };
  }
}
