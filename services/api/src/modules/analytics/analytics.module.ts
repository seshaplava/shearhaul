import { Controller, Get, Module, Param } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('savings')
class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('trip/:tripId')
  async savings(@Param('tripId') tripId: string) {
    const row = await this.prisma.savingsLedger.findUnique({
      where: { tripId },
    });
    if (!row) {
      return { tripId, inrSaved: 0, kmSaved: 0, co2KgProxy: 0 };
    }
    return row;
  }

  @Get('kpis/:code')
  async corridorKpis(@Param('code') code: string) {
    const corridor = await this.prisma.corridor.findUnique({ where: { code } });
    if (!corridor) return { code, loads: 0, trips: 0 };
    const [loads, trips, savings] = await Promise.all([
      this.prisma.loadRequest.count({ where: { corridorId: corridor.id } }),
      this.prisma.trip.count({ where: { corridorId: corridor.id } }),
      this.prisma.savingsLedger.aggregate({
        _sum: { inrSaved: true, co2KgProxy: true },
      }),
    ]);
    return {
      code,
      loads,
      trips,
      inrSavedTotal: savings._sum.inrSaved ?? 0,
      co2KgTotal: savings._sum.co2KgProxy ?? 0,
    };
  }
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
