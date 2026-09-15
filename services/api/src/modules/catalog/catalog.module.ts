import { Controller, Get, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const CORRIDORS: Array<{
  code: string;
  originCity: string;
  destCity: string;
  basePaisa: number;
  perKmPaisa: number;
  perKgPaisa: number;
}> = [
  {
    code: 'BOM-PNQ',
    originCity: 'Mumbai',
    destCity: 'Pune',
    basePaisa: 450000,
    perKmPaisa: 2500,
    perKgPaisa: 50,
  },
  {
    code: 'DEL-JAI',
    originCity: 'Delhi',
    destCity: 'Jaipur',
    basePaisa: 520000,
    perKmPaisa: 2400,
    perKgPaisa: 48,
  },
  {
    code: 'MAA-BLR',
    originCity: 'Chennai',
    destCity: 'Bengaluru',
    basePaisa: 480000,
    perKmPaisa: 2300,
    perKgPaisa: 52,
  },
  {
    code: 'HYD-BLR',
    originCity: 'Hyderabad',
    destCity: 'Bengaluru',
    basePaisa: 500000,
    perKmPaisa: 2450,
    perKgPaisa: 50,
  },
  {
    code: 'AMD-BOM',
    originCity: 'Ahmedabad',
    destCity: 'Mumbai',
    basePaisa: 560000,
    perKmPaisa: 2600,
    perKgPaisa: 55,
  },
  {
    code: 'PNQ-BOM',
    originCity: 'Pune',
    destCity: 'Mumbai',
    basePaisa: 420000,
    perKmPaisa: 2400,
    perKgPaisa: 48,
  },
];

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const c of CORRIDORS) {
      const corridor = await this.prisma.corridor.upsert({
        where: { code: c.code },
        create: {
          code: c.code,
          originCity: c.originCity,
          destCity: c.destCity,
          active: true,
        },
        update: { active: true, originCity: c.originCity, destCity: c.destCity },
      });
      const card = await this.prisma.rateCard.findFirst({
        where: { corridorId: corridor.id, vehicleType: 'truck_14ft', active: true },
      });
      if (!card) {
        await this.prisma.rateCard.create({
          data: {
            corridorId: corridor.id,
            vehicleType: 'truck_14ft',
            basePaisa: c.basePaisa,
            perKmPaisa: c.perKmPaisa,
            perKgPaisa: c.perKgPaisa,
          },
        });
      }
    }
  }
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('corridors')
  corridors() {
    return this.prisma.corridor.findMany({ orderBy: { code: 'asc' } });
  }

  @Get('rate-cards')
  rateCards() {
    return this.prisma.rateCard.findMany({
      where: { active: true },
      include: { corridor: true },
    });
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
