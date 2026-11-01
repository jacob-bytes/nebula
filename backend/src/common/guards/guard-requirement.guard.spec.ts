import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GuardRequirementGuard } from './guard-requirement.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** 构造最小 ExecutionContext（只需要 handler / class / method / path） */
function contextOf(handler: object, cls: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/api/files' }),
    }),
  } as unknown as ExecutionContext;
}

class AnyGuard {}

describe('GuardRequirementGuard（fail-closed）', () => {
  const guard = new GuardRequirementGuard(new Reflector());

  it('标记 @Public 的接口直接放行', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    expect(guard.canActivate(contextOf(handler, class C {}))).toBe(true);
  });

  it('控制器级 @Public 同样放行', () => {
    const handler = () => undefined;
    class Ctrl {}
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, Ctrl);
    expect(guard.canActivate(contextOf(handler, Ctrl))).toBe(true);
  });

  it('路由自带守卫时放行（不改变既有行为，鉴权交给那些守卫）', () => {
    const handler = () => undefined;
    Reflect.defineMetadata('__guards__', [AnyGuard], handler);
    expect(guard.canActivate(contextOf(handler, class C {}))).toBe(true);
  });

  it('控制器级守卫也视为已声明', () => {
    const handler = () => undefined;
    class Ctrl {}
    Reflect.defineMetadata('__guards__', [AnyGuard], Ctrl);
    expect(guard.canActivate(contextOf(handler, Ctrl))).toBe(true);
  });

  it('既无守卫又无 @Public → 403（新增接口漏配时不会静默公开）', () => {
    const handler = () => undefined;
    expect(() => guard.canActivate(contextOf(handler, class C {}))).toThrow(ForbiddenException);
  });
});
