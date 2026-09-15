import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ClaimStatus, KycStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdentityModule } from '../identity/identity.module';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';

class FlagPatchDto {
  @IsBoolean()
  enabled!: boolean;
}

class ReviewKycDto {
  @IsEnum(KycStatus)
  status!: KycStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ReviewClaimDto {
  @IsEnum(ClaimStatus)
  status!: ClaimStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('admin')
class AdminBffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  @Get('overview')
  async overview() {
    const [users, loads, trips, flags, payments, claims, notifications, openClaims, pendingKyc] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.loadRequest.count(),
        this.prisma.trip.count(),
        this.prisma.featureFlag.findMany(),
        this.prisma.paymentIntent.count(),
        this.prisma.claim.count(),
        this.prisma.appNotification.count(),
        this.prisma.claim.count({ where: { status: ClaimStatus.OPEN } }),
        this.prisma.kycDocument.count({
          where: { status: { in: [KycStatus.SUBMITTED, KycStatus.IN_REVIEW] } },
        }),
      ]);
    return {
      users,
      loads,
      trips,
      payments,
      claims,
      notifications,
      openClaims,
      pendingKyc,
      flags,
    };
  }

  @Get('trips')
  trips(@Query('status') status?: string, @Query('mode') mode?: string) {
    return this.prisma.trip.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(mode ? { mode: mode as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        vehicle: true,
        driver: true,
        stops: { include: { pod: true } },
        payments: true,
        claims: true,
        savings: true,
      },
    });
  }

  @Get('loads')
  loads() {
    return this.prisma.loadRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { corridor: true, shipper: true },
    });
  }

  @Get('claims')
  claims(@Query('status') status?: string) {
    return this.prisma.claim.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { trip: true },
    });
  }

  @Get('kyc')
  kycQueue(@Query('all') all?: string) {
    return this.prisma.kycDocument.findMany({
      where:
        all === '1'
          ? undefined
          : { status: { in: [KycStatus.SUBMITTED, KycStatus.IN_REVIEW] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Patch('flags/:key')
  async setFlag(@Param('key') key: string, @Body() dto: FlagPatchDto) {
    return this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled: dto.enabled },
      update: { enabled: dto.enabled },
    });
  }

  @Post('kyc/:id/review')
  async reviewKyc(@Param('id') id: string, @Body() dto: ReviewKycDto) {
    if (
      dto.status !== KycStatus.VERIFIED &&
      dto.status !== KycStatus.REJECTED &&
      dto.status !== KycStatus.IN_REVIEW
    ) {
      throw new BadRequestException('Invalid KYC status');
    }
    const doc = await this.prisma.kycDocument.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes },
    });
    await this.prisma.driverProfile.updateMany({
      where: { userId: doc.userId },
      data: { kycStatus: dto.status },
    });
    await this.notify.push(
      doc.userId,
      'KYC updated',
      `Document ${doc.docType} → ${dto.status}`,
    );
    return doc;
  }

  @Post('claims/:id/review')
  async reviewClaim(@Param('id') id: string, @Body() dto: ReviewClaimDto) {
    const claim = await this.prisma.claim.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes },
      include: { trip: { include: { driver: true } } },
    });
    if (claim.trip.driver?.userId) {
      await this.notify.push(
        claim.trip.driver.userId,
        'Claim updated',
        `Claim ${claim.type} → ${dto.status}`,
        { claimId: claim.id },
      );
    }
    return claim;
  }
}

@Module({
  imports: [IdentityModule, NotificationModule],
  controllers: [AdminBffController],
})
export class AdminBffModule {}
