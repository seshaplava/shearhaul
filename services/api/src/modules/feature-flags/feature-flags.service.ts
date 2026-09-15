import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const DEFAULT_FLAGS: Array<{ key: string; enabled: boolean }> = [
  { key: 'mode.shared.enabled', enabled: true },
  { key: 'mode.return.enabled', enabled: true },
  { key: 'payments.escrow.enabled', enabled: true },
  { key: 'insurance.sku.enabled', enabled: true },
];

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const flag of DEFAULT_FLAGS) {
      await this.prisma.featureFlag.upsert({
        where: { key: flag.key },
        create: flag,
        update: { enabled: flag.enabled },
      });
    }
  }

  list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async isEnabled(key: string, fallback = false) {
    const row = await this.prisma.featureFlag.findUnique({ where: { key } });
    return { key, enabled: row?.enabled ?? fallback };
  }
}
