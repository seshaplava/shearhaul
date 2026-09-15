import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoadStatus,
  StopType,
  TripStatus,
  UserRole,
} from '@prisma/client';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';

const ALLOWED: Partial<Record<TripStatus, TripStatus[]>> = {
  [TripStatus.ASSIGNED]: [TripStatus.EN_ROUTE_PICKUP, TripStatus.CANCELLED],
  [TripStatus.EN_ROUTE_PICKUP]: [TripStatus.AT_PICKUP, TripStatus.CANCELLED],
  [TripStatus.AT_PICKUP]: [TripStatus.LOADED, TripStatus.CANCELLED],
  [TripStatus.LOADED]: [TripStatus.IN_TRANSIT, TripStatus.DISPUTED],
  [TripStatus.IN_TRANSIT]: [TripStatus.AT_DROPOFF, TripStatus.DISPUTED],
  [TripStatus.AT_DROPOFF]: [TripStatus.DELIVERED, TripStatus.DISPUTED],
  [TripStatus.DELIVERED]: [TripStatus.SETTLING],
  [TripStatus.SETTLING]: [TripStatus.SETTLED],
};

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class SubmitPodDto {
  @IsUUID()
  stopId!: string;

  @IsOptional()
  @IsString()
  photoS3Key?: string;

  @IsOptional()
  @IsString()
  otp?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsBoolean()
  signatureOk?: boolean;
}

@Injectable()
export class TripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  async getById(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        stops: { orderBy: { seq: 'asc' }, include: { pod: true } },
        vehicle: true,
        driver: true,
        events: { orderBy: { createdAt: 'asc' } },
        payments: true,
      },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async accept(tripId: string, userId: string, roles: string[]) {
    if (!roles.includes(UserRole.DRIVER)) {
      throw new ForbiddenException('Driver role required');
    }
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!driver) throw new BadRequestException('Driver profile missing');

    const trip = await this.getById(tripId);
    if (trip.driverId !== driver.id) {
      throw new ForbiddenException('Not assigned to you');
    }
    if (trip.status !== TripStatus.ASSIGNED) {
      return { trip, message: `Already in status ${trip.status}` };
    }
    return {
      trip,
      message:
        'Assignment confirmed — update status to EN_ROUTE_PICKUP when moving',
    };
  }

  async submitPod(tripId: string, userId: string, roles: string[], dto: SubmitPodDto) {
    if (!roles.includes(UserRole.DRIVER) && !roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Driver or admin required');
    }
    const trip = await this.getById(tripId);
    if (roles.includes(UserRole.DRIVER)) {
      const driver = await this.prisma.driverProfile.findUnique({
        where: { userId },
      });
      if (!driver || trip.driverId !== driver.id) {
        throw new ForbiddenException('Not your trip');
      }
    }

    const stopRow = trip.stops.find((s) => s.id === dto.stopId);
    if (!stopRow) throw new NotFoundException('Stop not found on trip');

    const otpOk = !dto.otp || dto.otp === '000000' || dto.otp.length >= 4;
    let geoOk = true;
    if (dto.lat != null && dto.lng != null) {
      const dist = haversineM(dto.lat, dto.lng, stopRow.lat, stopRow.lng);
      geoOk = dist <= 1500; // 1.5km geofence for demo
    }
    const passed = otpOk && geoOk && (dto.signatureOk !== false);

    const pod = await this.prisma.pod.upsert({
      where: { stopId: stopRow.id },
      create: {
        stopId: stopRow.id,
        photoS3Key: dto.photoS3Key ?? 'demo/pod.jpg',
        otpOk,
        geoOk,
        passed,
        signedAt: passed ? new Date() : null,
      },
      update: {
        photoS3Key: dto.photoS3Key ?? 'demo/pod.jpg',
        otpOk,
        geoOk,
        passed,
        signedAt: passed ? new Date() : null,
      },
    });

    return { pod, stop: stopRow, message: passed ? 'POD passed' : 'POD rejected' };
  }

  async updateStatus(
    tripId: string,
    userId: string,
    roles: string[],
    toStatus: TripStatus,
  ) {
    const trip = await this.getById(tripId);
    const allowed = ALLOWED[trip.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(
        `Cannot transition ${trip.status} → ${toStatus}`,
      );
    }

    if (roles.includes(UserRole.DRIVER)) {
      const driver = await this.prisma.driverProfile.findUnique({
        where: { userId },
      });
      if (!driver || trip.driverId !== driver.id) {
        throw new ForbiddenException('Not your trip');
      }
    } else if (!roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Driver or admin required');
    }

    if (toStatus === TripStatus.LOADED) {
      const pickups = trip.stops.filter((s) => s.type === StopType.PICKUP);
      if (pickups.length && !pickups.every((s) => s.pod?.passed)) {
        throw new BadRequestException(
          'All pickup PODs must pass before LOADED',
        );
      }
    }

    if (toStatus === TripStatus.DELIVERED) {
      const dropoffs = trip.stops.filter((s) => s.type === StopType.DROPOFF);
      const allPassed = dropoffs.every((s) => s.pod?.passed);
      if (!allPassed) {
        throw new BadRequestException(
          'All dropoff PODs must pass before DELIVERED',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.trip.update({
        where: { id: tripId },
        data: { status: toStatus },
        include: {
          stops: { include: { pod: true } },
          vehicle: true,
          driver: true,
          payments: true,
        },
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          fromStatus: trip.status,
          toStatus,
          actorId: userId,
        },
      });

      const stopLoadIds = trip.stops
        .map((s) => s.loadId)
        .filter((id): id is string => !!id);

      if (
        (
          [
            TripStatus.EN_ROUTE_PICKUP,
            TripStatus.AT_PICKUP,
            TripStatus.LOADED,
            TripStatus.IN_TRANSIT,
            TripStatus.AT_DROPOFF,
            TripStatus.DELIVERED,
          ] as TripStatus[]
        ).includes(toStatus) &&
        stopLoadIds.length
      ) {
        await tx.loadRequest.updateMany({
          where: { id: { in: stopLoadIds } },
          data: {
            status:
              toStatus === TripStatus.DELIVERED
                ? LoadStatus.IN_TRIP
                : LoadStatus.IN_TRIP,
          },
        });
      }

      if (toStatus === TripStatus.SETTLED && stopLoadIds.length) {
        await tx.loadRequest.updateMany({
          where: { id: { in: stopLoadIds } },
          data: { status: LoadStatus.COMPLETED },
        });
      }

      return next;
    });

    if (toStatus === TripStatus.DELIVERED) {
      let settlement: {
        payment?: unknown;
        platformFeePaisa?: number;
        driverPayoutPaisa?: number;
        skipped?: boolean;
      };
      try {
        settlement = await this.payments.settleTrip(tripId);
      } catch {
        settlement = { skipped: true };
      }
      const settled = await this.prisma.$transaction(async (tx) => {
        await tx.trip.update({
          where: { id: tripId },
          data: { status: TripStatus.SETTLING },
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            fromStatus: TripStatus.DELIVERED,
            toStatus: TripStatus.SETTLING,
            actorId: userId,
            meta: settlement as object,
          },
        });
        const finalTrip = await tx.trip.update({
          where: { id: tripId },
          data: { status: TripStatus.SETTLED },
          include: {
            stops: { include: { pod: true } },
            vehicle: true,
            driver: true,
            payments: true,
          },
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            fromStatus: TripStatus.SETTLING,
            toStatus: TripStatus.SETTLED,
            actorId: userId,
          },
        });
        const stopLoadIds = trip.stops
          .map((s) => s.loadId)
          .filter((id): id is string => !!id);
        if (stopLoadIds.length) {
          await tx.loadRequest.updateMany({
            where: { id: { in: stopLoadIds } },
            data: { status: LoadStatus.COMPLETED },
          });
        }
        return finalTrip;
      });
      return { trip: settled, settlement };
    }

    return { trip: updated };
  }

  async listForDriver(userId: string) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!driver) return [];
    return this.prisma.trip.findMany({
      where: { driverId: driver.id },
      orderBy: { createdAt: 'desc' },
      include: { stops: { include: { pod: true } }, vehicle: true },
    });
  }
}
