import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoadMode,
  LoadStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateLoadDto } from './dto/create-load.dto';

@Injectable()
export class LoadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async create(userId: string, roles: string[], dto: CreateLoadDto) {
    if (!roles.includes(UserRole.SHIPPER)) {
      throw new ForbiddenException('Shipper role required');
    }
    if (dto.mode === LoadMode.SHARED) {
      const shared = await this.flags.isEnabled('mode.shared.enabled', false);
      if (!shared.enabled) {
        throw new BadRequestException(
          'Shared mode is disabled for this corridor/environment',
        );
      }
    }
    if (dto.mode === LoadMode.RETURN) {
      const ret = await this.flags.isEnabled('mode.return.enabled', false);
      if (!ret.enabled) {
        throw new BadRequestException('Return mode is disabled');
      }
    }

    const shipper = await this.prisma.shipperProfile.findUnique({
      where: { userId },
    });
    if (!shipper) {
      throw new BadRequestException('Shipper profile missing — verify OTP as SHIPPER');
    }

    let corridorId = dto.corridorId;
    if (!corridorId && dto.corridorCode) {
      const corridor = await this.prisma.corridor.findUnique({
        where: { code: dto.corridorCode },
      });
      if (!corridor?.active) {
        throw new BadRequestException('Corridor not found or inactive');
      }
      corridorId = corridor.id;
    }

    if (new Date(dto.windowEnd) <= new Date(dto.windowStart)) {
      throw new BadRequestException('windowEnd must be after windowStart');
    }

    const load = await this.prisma.loadRequest.create({
      data: {
        shipperId: shipper.id,
        corridorId,
        mode: dto.mode,
        status: LoadStatus.OPEN,
        originLat: dto.originLat,
        originLng: dto.originLng,
        originAddress: dto.originAddress,
        destLat: dto.destLat,
        destLng: dto.destLng,
        destAddress: dto.destAddress,
        weightKg: dto.weightKg,
        volumeCft: dto.volumeCft,
        cargoType: dto.cargoType,
        windowStart: new Date(dto.windowStart),
        windowEnd: new Date(dto.windowEnd),
      },
      include: { corridor: true },
    });

    await this.prisma.loadRequest.update({
      where: { id: load.id },
      data: { status: LoadStatus.MATCHING },
    });

    return this.prisma.loadRequest.findUniqueOrThrow({
      where: { id: load.id },
      include: { corridor: true },
    });
  }

  async listForUser(userId: string, roles: string[]) {
    if (roles.includes(UserRole.SHIPPER)) {
      const shipper = await this.prisma.shipperProfile.findUnique({
        where: { userId },
      });
      if (!shipper) return [];
      const loads = await this.prisma.loadRequest.findMany({
        where: { shipperId: shipper.id },
        orderBy: { createdAt: 'desc' },
        include: {
          corridor: true,
          offers: {
            where: { tripId: { not: null } },
            select: { tripId: true },
            take: 1,
          },
          stops: {
            select: { tripId: true },
            take: 1,
          },
        },
      });
      return loads.map(({ offers, stops, ...rest }) => ({
        ...rest,
        tripId: offers[0]?.tripId ?? stops[0]?.tripId ?? null,
      }));
    }
    throw new ForbiddenException('Shipper role required to list loads');
  }

  async getById(id: string) {
    const load = await this.prisma.loadRequest.findUnique({
      where: { id },
      include: {
        corridor: true,
        offers: true,
        stops: {
          select: { tripId: true },
          take: 1,
        },
      },
    });
    if (!load) throw new NotFoundException('Load not found');
    const tripId =
      load.offers.find((o) => o.tripId != null)?.tripId ??
      load.stops[0]?.tripId ??
      null;
    const { stops: _stops, ...rest } = load;
    return { ...rest, tripId };
  }
}
