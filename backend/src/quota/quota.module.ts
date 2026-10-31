import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { File } from '../common/entities/file.entity';
import { User } from '../common/entities/user.entity';
import { QuotaController } from './quota.controller';
import { QuotaService } from './quota.service';

/**
 * 存储配额模块。
 *
 * 直接注册实体而不依赖 FileModule：配额只做 `SUM(size)` 只读汇总，
 * 若反向依赖 FileModule 会形成 File → Quota → File 的循环。
 */
@Module({
  imports: [TypeOrmModule.forFeature([File, User])],
  controllers: [QuotaController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
