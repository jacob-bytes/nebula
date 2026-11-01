import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../common/entities/user.entity';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { RateLimitModule } from '../common/services/rate-limit.module';

/**
 * 首次运行向导。
 *
 * 只在「用户表为空 + SETUP_MODE=true」时可用；其余情况接口一律拒绝，
 * 因此挂进主模块不会扩大攻击面（写操作仍需一次性安装令牌）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), RateLimitModule],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
