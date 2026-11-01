import { SetMetadata } from '@nestjs/common';

/** 标记「无需鉴权」的控制器或方法：由 GuardRequirementGuard 读取 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 显式声明公开接口。
 *
 * 全局守卫默认要求「每个路由要么带鉴权守卫，要么显式标记 @Public」，
 * 因此新增公开接口必须在这里声明——漏标会被拒绝并给出明确错误，
 * 而不是悄悄暴露出去（fail-closed）。
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
