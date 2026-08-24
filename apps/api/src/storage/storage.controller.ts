import { Controller, Get, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { StorageService } from "./storage.service";
import { fail } from "../domain/errors";

@Controller("storage")
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get("read")
  async read(
    @Query("key") key: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ) {
    const local = this.storage.local;
    if (!local) fail("STORAGE_PROVIDER_UNAVAILABLE");
    if (!local.verify(key, Number(exp), sig || "")) fail("SPACE_ACCESS_DENIED", 403);
    const buf = await this.storage.getObject(key);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buf);
  }
}
