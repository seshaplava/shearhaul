import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ClaimStatus, ClaimType, TripStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';

class OpenClaimDto {
  @IsUUID()
  tripId!: string;

  @IsEnum(ClaimType)
  type!: ClaimType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  amountClaimed?: number;

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

@Controller('claims')
@UseGuards(JwtAuthGuard)
class ClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  @Post()
  async open(@CurrentUser() user: AuthUser, @Body() dto: OpenClaimDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { driver: true },
    });
    if (!trip) throw new BadRequestException('Trip not found');

    const claim = await this.prisma.$transaction(async (tx) => {
      const c = await tx.claim.create({
        data: {
          tripId: dto.tripId,
          type: dto.type,
          amountClaimed: dto.amountClaimed,
          notes: dto.notes,
          status: ClaimStatus.OPEN,
        },
      });
      await tx.trip.update({
        where: { id: dto.tripId },
        data: { status: TripStatus.DISPUTED },
      });
      await tx.paymentIntent.updateMany({
        where: { tripId: dto.tripId, status: 'HELD' },
        data: { status: 'DISPUTE_HOLD' },
      });
      return c;
    });

    if (trip.driver?.userId) {
      await this.notify.push(
        trip.driver.userId,
        'Claim opened',
        `A ${dto.type} claim was opened on your trip`,
        { claimId: claim.id },
      );
    }
    return claim;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    if (user.roles.includes(UserRole.ADMIN)) {
      return this.prisma.claim.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { trip: true },
      });
    }
    return this.prisma.claim.findMany({
      where: {
        trip: {
          OR: [
            { driver: { userId: user.userId } },
            {
              stops: {
                some: {
                  load: { shipper: { userId: user.userId } },
                },
              },
            },
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { trip: true },
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.claim.findUnique({
      where: { id },
      include: { trip: true },
    });
  }

  @Post(':id/review')
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewClaimDto,
  ) {
    if (!user.roles.includes(UserRole.ADMIN)) {
      throw new BadRequestException('Admin only');
    }
    return this.prisma.claim.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes },
    });
  }
}

@Module({
  imports: [IdentityModule, NotificationModule],
  controllers: [ClaimsController],
})
export class ClaimsModule {}
