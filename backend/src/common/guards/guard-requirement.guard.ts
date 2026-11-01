import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Nest 在路由处理器元数据里存守卫列表用的键 */
const NEST_GUARDS_METADATA = '__guards__';

/**
 * 全局「必须声明鉴权」守卫（fail-closed）。
 *
 * 为什么需要它：鉴权此前完全依赖开发者给每个控制器手工加 `@UseGuards(...)`，
 * 漏写即等于公开接口，而且没有任何提示。本守卫不改变已有路由的行为——
 * 路由若自带守卫，直接放行（由那些守卫完成鉴权）；只有当路由**既没有守卫、
 * 也没有 `@Public()` 标记**时才拒绝，并给出可操作的错误信息。
 *
 * 这样做的取舍：不在全局强制某种具体鉴权方式（Cookie JWT / API Key / 分享令牌
 * 各不相同），只强制「必须明确声明」。
 */
@Injectable()
export class GuardRequirementGuard implements CanActivate {
  private readonly logger = new Logger(GuardRequirementGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const guards = targets.some((target) => {
      const declared = Reflect.getMetadata(NEST_GUARDS_METADATA, target) as unknown[] | undefined;
      return Array.isArray(declared) && declared.length > 0;
    });
    if (guards) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const route = `${request.method} ${request.path}`;
    this.logger.error(`拒绝未声明鉴权的接口：${route}（加 @UseGuards(...) 或 @Public()）`);
    throw new ForbiddenException('该接口未声明鉴权策略；请联系管理员');
  }
}
