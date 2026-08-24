import { Controller, Get } from "@nestjs/common";
import { StorageService, resolveStorageProviderName } from "./storage/storage.service";
import { PrismaService } from "./prisma.service";

@Controller()
export class HealthController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("health")
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      product: "个人图片中心",
      storageProvider: this.storage.providerName,
      configuredProvider: resolveStorageProviderName(),
    };
  }
}
