import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export class TrackingPointDto {
  @Type(() => Number)
  @IsNumber()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  speed?: number;

  @IsDateString()
  recordedAt!: string;
}

export class IngestTrackingDto {
  @IsUUID()
  tripId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TrackingPointDto)
  points!: TrackingPointDto[];
}

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(userId: string, roles: string[], dto: IngestTrackingDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { driver: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');

    if (roles.includes(UserRole.DRIVER)) {
      if (!trip.driver || trip.driver.userId !== userId) {
        throw new ForbiddenException('Not your trip');
      }
    } else if (!roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Driver or admin required');
    }

    if (dto.points.length > 200) {
      throw new BadRequestException('Max 200 points per batch');
    }

    const data = dto.points.map((p) => ({
      tripId: dto.tripId,
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      recordedAt: new Date(p.recordedAt),
    }));

    const result = await this.prisma.trackingPoint.createMany({ data });
    const last = data[data.length - 1];
    return {
      accepted: result.count,
      last: { lat: last.lat, lng: last.lng, recordedAt: last.recordedAt },
    };
  }

  async latestLocation(tripId: string) {
    const point = await this.prisma.trackingPoint.findFirst({
      where: { tripId },
      orderBy: { recordedAt: 'desc' },
    });
    if (!point) {
      return { tripId, location: null };
    }
    return {
      tripId,
      location: {
        lat: point.lat,
        lng: point.lng,
        speed: point.speed,
        recordedAt: point.recordedAt,
      },
    };
  }
}
