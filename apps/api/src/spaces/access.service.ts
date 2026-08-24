import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { Capability, hasCapability, SpaceRole } from "../domain/capabilities";
import { fail } from "../domain/errors";

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(userId: string, spaceId: string, capability: Capability) {
    const member = await this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
      include: { space: true, user: true },
    });
    if (!member) fail("SPACE_ACCESS_DENIED");
    if (!hasCapability(member.role as SpaceRole, capability)) fail("SPACE_ACCESS_DENIED");
    return member;
  }

  async membership(userId: string, spaceId: string) {
    return this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
    });
  }
}
