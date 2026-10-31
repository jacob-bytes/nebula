import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../common/entities/user.entity';
import { QuotaService, StorageQuotaSummary } from './quota.service';

export class SetStorageQuotaDto {
  /**
   * 配额字节数：
   *   null → 恢复为继承全局默认（DEFAULT_USER_STORAGE_QUOTA_MB）
   *   0    → 明确不限
   *   >0   → 上限
   * 省略该字段视为「不修改」，因此这里不做必填约束。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quotaBytes 必须是整数（字节）' })
  @Min(0, { message: 'quotaBytes 不能为负数' })
  quotaBytes?: number | null;
}

export class SetStorageQuotaBatchDto {
  /** 目标用户 id 列表（去重后落库，上限 500 条以避免单请求过大） */
  @IsArray({ message: 'userIds 必须是数组' })
  @ArrayNotEmpty({ message: 'userIds 不能为空' })
  @ArrayMaxSize(500, { message: '单次最多调整 500 个用户' })
  @IsUUID('4', { each: true, message: 'userIds 含非法用户 id' })
  userIds: string[];

  /** 同单用户接口：null 恢复全局默认，0 明确不限，>0 为字节上限 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quotaBytes 必须是整数（字节）' })
  @Min(0, { message: 'quotaBytes 不能为负数' })
  quotaBytes?: number | null;
}

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class QuotaController {
  constructor(private readonly quotaService: QuotaService) {}

  /** 当前登录用户的配额与用量。 */
  @Get('quota')
  async getMyQuota(@CurrentUser() user: User): Promise<StorageQuotaSummary> {
    return this.quotaService.getSummary(user.id);
  }

  /** 管理员查看指定用户的配额与用量。 */
  @Get('admin/users/:id/quota')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getUserQuota(@Param('id', ParseUUIDPipe) id: string): Promise<StorageQuotaSummary> {
    return this.quotaService.getSummary(id);
  }

  /**
   * 批量设置配额。
   *
   * 路由段数与 `admin/users/:id/quota` 相同但末段不同，不会互相遮蔽；
   * 仍声明在前，避免未来调整路由顺序时被参数路由抢先匹配。
   */
  @Put('admin/users/quota/batch')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async setUserQuotaBatch(
    @Body() dto: SetStorageQuotaBatchDto,
  ): Promise<{ requested: number; updated: number; missing: number }> {
    const hasValue = Object.prototype.hasOwnProperty.call(dto, 'quotaBytes');
    if (!hasValue) {
      // 缺省 quotaBytes 时无法判断意图：明确拒绝，避免把「忘了传」当成「设为不限」
      throw new BadRequestException('批量设置必须显式提供 quotaBytes（null 表示恢复默认，0 表示不限）');
    }
    return this.quotaService.setQuotaBatch(dto.userIds, dto.quotaBytes ?? null);
  }

  /** 管理员设置指定用户的配额；显式传 null 恢复全局默认。 */
  @Put('admin/users/:id/quota')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async setUserQuota(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStorageQuotaDto,
  ): Promise<StorageQuotaSummary> {
    // `quotaBytes` 显式出现时按值处理（含 null），缺省时保持原值不变
    const hasValue = Object.prototype.hasOwnProperty.call(dto, 'quotaBytes');
    if (!hasValue) return this.quotaService.getSummary(id);
    return this.quotaService.setQuota(id, dto.quotaBytes ?? null);
  }
}
