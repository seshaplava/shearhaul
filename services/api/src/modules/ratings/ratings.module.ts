import {
  BadRequestException,
  Body,
  Controller,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';

class CreateRatingDto {
  @IsUUID()
  tripId!: string;

  @IsUUID()
  toUserId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}

@Controller('ratings')
@UseGuards(JwtAuthGuard)
class RatingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateRatingDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { driver: true },
    });
    if (!trip) throw new BadRequestException('Trip not found');
    if (!['DELIVERED', 'SETTLED', 'SETTLING'].includes(trip.status)) {
      throw new BadRequestException('Rate after delivery');
    }

    const rating = await this.prisma.rating.create({
      data: {
        tripId: dto.tripId,
        fromUserId: user.userId,
        toUserId: dto.toUserId,
        stars: dto.stars,
        tags: dto.tags ?? [],
        comment: dto.comment,
      },
    });

    if (trip.driver && trip.driver.userId === dto.toUserId) {
      const all = await this.prisma.rating.findMany({
        where: { toUserId: dto.toUserId },
      });
      const avg = all.reduce((s, r) => s + r.stars, 0) / all.length;
      await this.prisma.driverProfile.update({
        where: { id: trip.driver.id },
        data: { ratingAvg: Number(avg.toFixed(2)) },
      });
    }

    return rating;
  }
}

@Module({
  imports: [IdentityModule],
  controllers: [RatingsController],
})
export class RatingsModule {}
