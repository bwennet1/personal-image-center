import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestUser } from "../auth/auth.service";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
  return req.user;
});
