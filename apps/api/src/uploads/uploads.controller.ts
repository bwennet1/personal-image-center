import { Body, Controller, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { UploadsService } from "./uploads.service";

async function readBody(req: Request): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === "object" && Buffer.isBuffer((req as unknown as { rawBody?: Buffer }).rawBody)) {
    return (req as unknown as { rawBody: Buffer }).rawBody;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

@Controller("uploads")
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post("session")
  session(
    @CurrentUser() user: RequestUser,
    @Body() body: { spaceId?: string; filename?: string; mimeType?: string; bytes?: number },
  ) {
    return this.uploads.createSession(user.id, {
      spaceId: body.spaceId || "",
      filename: body.filename || "image.jpg",
      mimeType: body.mimeType,
      bytes: Number(body.bytes || 0),
    });
  }

  @Put(":sessionId/object")
  async putObject(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Req() req: Request,
  ) {
    const buf = await readBody(req);
    return this.uploads.putObject(sessionId, buf, user.id);
  }

  @Post(":sessionId/complete")
  complete(@CurrentUser() user: RequestUser, @Param("sessionId") sessionId: string) {
    return this.uploads.complete(sessionId, user.id);
  }
}
