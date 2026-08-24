import "reflect-metadata";

(BigInt.prototype as unknown as { toJSON?: () => string }).toJSON = function toJSON() {
  return this.toString();
};
import { NestFactory } from "@nestjs/core";
import { json, raw, urlencoded, Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http-exception.filter";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage/storage.service";
import { startImageWorker } from "./jobs/image.queue";

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "PUT" && req.path.includes("/uploads/") && req.path.endsWith("/object")) {
      return raw({ type: "*/*", limit: "80mb" })(req, res, next);
    }
    return json({ limit: "2mb" })(req, res, () => urlencoded({ extended: true })(req, res, next));
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true, credentials: true });
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);
  if (process.env.RUN_WORKER !== "false") {
    try {
      startImageWorker(prisma, storage);
    } catch (err) {
      console.warn("worker not started", err);
    }
  }
  const port = Number(process.env.PORT || 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`个人图片中心 API listening on ${port} storage=${storage.providerName}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
