import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { IdentityModule } from '../identity/identity.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

class InsuranceSelectDto {
  @IsUUID()
  loadId!: string;

  @IsOptional()
  @IsBoolean()
  select?: boolean;
}

@Controller('insurance')
@UseGuards(JwtAuthGuard)
class InsuranceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Post('quote')
  async quote(@Body() dto: InsuranceSelectDto) {
    const enabled = await this.flags.isEnabled('insurance.sku.enabled', false);
    if (!enabled.enabled) {
      throw new BadRequestException('Insurance SKU disabled');
    }
    const load = await this.prisma.loadRequest.findUnique({
      where: { id: dto.loadId },
    });
    if (!load) throw new BadRequestException('Load not found');
    const coverPaisa = Math.max(5000000, load.weightKg * 4000);
    const premiumPaisa = Math.round(coverPaisa * 0.004);
    return this.prisma.insuranceQuote.create({
      data: {
        loadId: dto.loadId,
        premiumPaisa,
        coverPaisa,
        selected: dto.select ?? false,
        sku: 'BASIC_CARGO',
      },
    });
  }

  @Get('load/:loadId')
  list(@Param('loadId') loadId: string) {
    return this.prisma.insuranceQuote.findMany({
      where: { loadId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

@Module({
  imports: [IdentityModule, FeatureFlagsModule],
  controllers: [InsuranceController],
})
export class InsuranceModule {}
