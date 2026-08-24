import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { BusinessError } from "../domain/errors";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof BusinessError) {
      res.status(exception.status).json({ code: exception.code, message: exception.message });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === "string" ? body : (body as { message?: string }).message;
      res.status(status).json({
        code: status === 401 ? "AUTH_REQUIRED" : "HTTP_ERROR",
        message: Array.isArray(message) ? message.join(", ") : message || exception.message,
      });
      return;
    }
    this.log.error(exception);
    res.status(500).json({ code: "INTERNAL_ERROR", message: "服务器内部错误" });
  }
}
