import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  KycStatus,
  LoadMode,
  LoadStatus,
  TripStatus,
  UserRole,
  StopType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { NotificationService } from '../notification/notification.service';
import {
  buildSharedStopPlan,
  haversineKm,
  routeLengthKm,
  splitSharedPrices,
  type GeoLoad,
} from './shared-pricing';

/** Shared loads wait this long for co-loads before solo / dedicated fallback. */
const SHARED_WAIT_MS = 90 * 1000;

/** 2nd shipper can join a Shared trip until the driver starts moving. */
const SHARED_JOINABLE: TripStatus[] = [TripStatus.ASSIGNED];

const INCOMPATIBLE: Record<string, string[]> = {
  food: ['hazardous', 'chemical'],
  hazardous: ['food', 'pharma'],
  pharma: ['hazardous', 'chemical'],
};

@Injectable()
export class MatchingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly flags: FeatureFlagsService,
    private readonly notify: NotificationService,
  ) {}

  async onModuleInit() {
    await this.ensureDemoSupply();
  }

  async getOffers(loadId: string) {
    const load = await this.prisma.loadRequest.findUnique({
      where: { id: loadId },
      include: { corridor: true },
    });
    if (!load) throw new NotFoundException('Load not found');

    if (load.mode === LoadMode.SHARED) {
      const f = await this.flags.isEnabled('mode.shared.enabled', false);
      if (!f.enabled) throw new BadRequestException('Shared mode disabled');
    }
    if (load.mode === LoadMode.RETURN) {
      const f = await this.flags.isEnabled('mode.return.enabled', false);
      if (!f.enabled) throw new BadRequestException('Return mode disabled');
    }

    await this.prisma.matchOffer.deleteMany({
      where: { loadId, tripId: null, expiresAt: { lt: new Date() } },
    });

    // Shared: always rebuild so new co-loads update each shipper's split price.
    if (load.mode === LoadMode.SHARED) {
      await this.prisma.matchOffer.deleteMany({
        where: { loadId, tripId: null },
      });
      return this.buildSharedOffers(load);
    }

    const existing = await this.prisma.matchOffer.findMany({
      where: { loadId, expiresAt: { gt: new Date() }, tripId: null },
      orderBy: { score: 'asc' },
    });
    if (existing.length > 0) {
      return { loadId, mode: load.mode, offers: existing };
    }

    return this.buildDedicatedOrReturnOffers(load);
  }

  private sharedWaitMeta(load: { mode: LoadMode; createdAt?: Date; updatedAt?: Date }) {
    if (load.mode !== LoadMode.SHARED) return {};
    const started = (load.createdAt ?? new Date()).getTime();
    const waitEndsAt = new Date(started + SHARED_WAIT_MS);
    const alone = Date.now() >= waitEndsAt.getTime();
    return {
      sharedWaitEndsAt: waitEndsAt.toISOString(),
      sharedWaitMinutes: Math.round(SHARED_WAIT_MS / 60000),
      canConvertDedicated: alone,
      aloneFallback: alone ? 'DEDICATED_OR_SOLO_SHARED' : 'WAITING_FOR_COLOADS',
    };
  }

  /** After shared wait timeout with no co-loads, convert load to Dedicated and re-offer. */
  async convertSharedToDedicated(loadId: string, shipperUserId: string) {
    const load = await this.prisma.loadRequest.findUnique({
      where: { id: loadId },
      include: { shipper: true },
    });
    if (!load) throw new NotFoundException('Load not found');
    if (load.shipper.userId !== shipperUserId) {
      throw new BadRequestException('Not your load');
    }
    if (load.mode !== LoadMode.SHARED) {
      throw new BadRequestException('Only SHARED loads can convert');
    }
    if (
      load.status !== LoadStatus.OPEN &&
      load.status !== LoadStatus.MATCHING
    ) {
      throw new BadRequestException('Load already booked');
    }
    const meta = this.sharedWaitMeta(load);
    const openOffers = await this.prisma.matchOffer.findMany({
      where: { loadId, tripId: null, expiresAt: { gt: new Date() } },
    });
    const solo =
      openOffers.length > 0 &&
      openOffers.every((o) => {
        const b = (o.priceBreakdown ?? {}) as Record<string, unknown>;
        return b.soloShared === true || Number(b.coLoadCount ?? 0) === 0;
      });
    if (!meta.canConvertDedicated && !solo) {
      throw new BadRequestException(
        `Still waiting for co-loads until ${meta.sharedWaitEndsAt}. Solo offers can convert anytime.`,
      );
    }

    await this.prisma.matchOffer.deleteMany({
      where: { loadId, tripId: null },
    });
    const updated = await this.prisma.loadRequest.update({
      where: { id: loadId },
      data: { mode: LoadMode.DEDICATED, status: LoadStatus.MATCHING },
    });
    const offers = await this.buildDedicatedOrReturnOffers(updated);
    return {
      message: 'Converted SHARED → DEDICATED after wait timeout',
      load: updated,
      ...offers,
    };
  }

  async selectOffer(offerId: string, shipperUserId: string) {
    const offer = await this.prisma.matchOffer.findUnique({
      where: { id: offerId },
      include: { load: { include: { shipper: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.expiresAt < new Date()) throw new BadRequestException('Offer expired');
    if (offer.tripId) throw new BadRequestException('Offer already selected');
    if (offer.load.shipper.userId !== shipperUserId) {
      throw new BadRequestException('Not your load');
    }
    if (!offer.vehicleId) throw new BadRequestException('Offer has no vehicle');

    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: offer.vehicleId },
    });
    if (!vehicle?.driverId) throw new BadRequestException('Vehicle has no driver');

    const breakdown = (offer.priceBreakdown ?? {}) as Record<string, unknown>;
    const joinTripId =
      typeof breakdown.joinTripId === 'string' ? breakdown.joinTripId : null;

    const activeTrip = await this.prisma.trip.findFirst({
      where: {
        vehicleId: vehicle.id,
        status: {
          notIn: [TripStatus.SETTLED, TripStatus.CANCELLED, TripStatus.DELIVERED],
        },
      },
    });

    // Real-time Shared: join open trip before driver starts (ASSIGNED).
    if (
      joinTripId ||
      (activeTrip &&
        offer.load.mode === LoadMode.SHARED &&
        activeTrip.mode === LoadMode.SHARED &&
        SHARED_JOINABLE.includes(activeTrip.status))
    ) {
      const tripId = joinTripId ?? activeTrip!.id;
      return this.joinSharedTripBeforeStart(offer.id, tripId, shipperUserId);
    }

    if (activeTrip) {
      throw new BadRequestException(
        'Vehicle already on an active trip (trip started — cannot join)',
      );
    }

    const coLoadIds = Array.isArray(breakdown.coLoadIds)
      ? (breakdown.coLoadIds as string[])
      : [];
    const loadIds = Array.from(new Set([offer.loadId, ...coLoadIds]));

    const loads = await this.prisma.loadRequest.findMany({
      where: { id: { in: loadIds } },
    });

    const trip = await this.prisma.$transaction(async (tx) => {
      const planned = Array.isArray(breakdown.stopPlan)
        ? (breakdown.stopPlan as Array<{
            seq: number;
            type: string;
            loadId: string;
            address: string;
            lat: number;
            lng: number;
          }>)
        : null;

      let stops: Array<{
        seq: number;
        type: StopType;
        loadId: string;
        address: string;
        lat: number;
        lng: number;
      }>;

      if (planned?.length) {
        stops = planned.map((s, i) => ({
          seq: s.seq ?? i + 1,
          type: s.type === 'DROPOFF' ? StopType.DROPOFF : StopType.PICKUP,
          loadId: s.loadId,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        }));
      } else {
        const geo: GeoLoad[] = loads.map((l) => ({
          id: l.id,
          weightKg: l.weightKg,
          volumeCft: l.volumeCft,
          originLat: l.originLat,
          originLng: l.originLng,
          destLat: l.destLat,
          destLng: l.destLng,
          originAddress: l.originAddress,
          destAddress: l.destAddress,
        }));
        const plan = buildSharedStopPlan(geo);
        stops = plan.map((s) => ({
          seq: s.seq,
          type: s.type === 'DROPOFF' ? StopType.DROPOFF : StopType.PICKUP,
          loadId: s.loadId,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        }));
      }

      const created = await tx.trip.create({
        data: {
          mode: offer.load.mode,
          status: TripStatus.ASSIGNED,
          vehicleId: vehicle.id,
          driverId: vehicle.driverId!,
          corridorId: offer.load.corridorId,
          events: {
            create: {
              toStatus: TripStatus.ASSIGNED,
              actorId: shipperUserId,
              meta: { offerId: offer.id, mode: offer.load.mode },
            },
          },
          stops: { create: stops },
        },
        include: { stops: true, vehicle: true, driver: true },
      });

      await tx.matchOffer.update({
        where: { id: offer.id },
        data: { tripId: created.id },
      });

      await tx.loadRequest.updateMany({
        where: { id: { in: loadIds } },
        data: { status: LoadStatus.BOOKED },
      });

      const dedicatedPaisa = Number(breakdown.dedicatedPaisa ?? offer.pricePaisa);
      const saved = Math.max(0, dedicatedPaisa - offer.pricePaisa);
      if (offer.load.mode === LoadMode.SHARED && saved > 0) {
        await tx.savingsLedger.create({
          data: {
            tripId: created.id,
            inrSaved: Math.round(saved / 100),
            kmSaved: Number(breakdown.kmSaved ?? 40),
            co2KgProxy: Number(breakdown.co2KgProxy ?? 12),
          },
        });
      }

      return created;
    });

    const hold = await this.payments.createEscrowHold({
      loadId: offer.loadId,
      tripId: trip.id,
      amountPaisa: offer.pricePaisa,
      idempotencyKey: `offer-hold:${offer.id}`,
    });
    const payment = hold.payment;

    const driverUserId = (
      await this.prisma.driverProfile.findUnique({
        where: { id: vehicle.driverId },
      })
    )?.userId;
    if (driverUserId) {
      await this.notify.push(
        driverUserId,
        'New trip assigned',
        `Trip ${trip.id.slice(0, 8)} · ${offer.load.mode}`,
        { tripId: trip.id },
      );
    }
    await this.notify.push(
      shipperUserId,
      'Truck assigned',
      `Your ${offer.load.mode} load is booked`,
      { tripId: trip.id },
    );

    return {
      trip,
      payment,
      checkout: hold.checkout,
      keyId: hold.keyId,
      offerId: offer.id,
      loadId: offer.loadId,
      message:
        payment.status === 'HELD'
          ? `Trip assigned (${offer.load.mode}) with escrow HOLD (${payment.gatewayProvider})`
          : `Trip assigned — complete Razorpay checkout to authorize escrow`,
    };
  }

  /** Second Shared shipper joins before driver advances past ASSIGNED. */
  private async joinSharedTripBeforeStart(
    offerId: string,
    tripId: string,
    shipperUserId: string,
  ) {
    const offer = await this.prisma.matchOffer.findUnique({
      where: { id: offerId },
      include: { load: { include: { shipper: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.expiresAt < new Date()) throw new BadRequestException('Offer expired');
    if (offer.tripId) throw new BadRequestException('Offer already selected');
    if (offer.load.shipper.userId !== shipperUserId) {
      throw new BadRequestException('Not your load');
    }
    if (offer.load.mode !== LoadMode.SHARED) {
      throw new BadRequestException('Only SHARED loads can join an open trip');
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        stops: { include: { pod: true } },
        vehicle: true,
      },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.mode !== LoadMode.SHARED) {
      throw new BadRequestException('Trip is not Shared');
    }
    if (!SHARED_JOINABLE.includes(trip.status)) {
      throw new BadRequestException(
        'Trip already started — cannot join after driver is en route',
      );
    }
    if (trip.stops.some((s) => s.pod?.passed)) {
      throw new BadRequestException('Trip already has POD — cannot join');
    }
    if (offer.vehicleId && trip.vehicleId && offer.vehicleId !== trip.vehicleId) {
      throw new BadRequestException('Offer vehicle does not match open trip');
    }

    const existingLoadIds = [
      ...new Set(
        trip.stops.map((s) => s.loadId).filter((id): id is string => !!id),
      ),
    ];
    if (existingLoadIds.includes(offer.loadId)) {
      throw new BadRequestException('Load already on this trip');
    }

    const allLoadIds = [...existingLoadIds, offer.loadId];
    const loads = await this.prisma.loadRequest.findMany({
      where: { id: { in: allLoadIds } },
    });
    if (loads.length !== allLoadIds.length) {
      throw new BadRequestException('Some loads missing for join');
    }

    const capacityKg = trip.vehicle?.capacityKg ?? 999999;
    const capacityCft = trip.vehicle?.capacityCft ?? 999999;
    const totalW = loads.reduce((s, l) => s + l.weightKg, 0);
    const totalV = loads.reduce((s, l) => s + l.volumeCft, 0);
    if (totalW > capacityKg || totalV > capacityCft) {
      throw new BadRequestException('Not enough capacity to join this truck');
    }

    const geo: GeoLoad[] = loads.map((l) => ({
      id: l.id,
      weightKg: l.weightKg,
      volumeCft: l.volumeCft,
      originLat: l.originLat,
      originLng: l.originLng,
      destLat: l.destLat,
      destLng: l.destLng,
      originAddress: l.originAddress,
      destAddress: l.destAddress,
    }));
    const plan = buildSharedStopPlan(geo);

    const updated = await this.prisma.$transaction(async (tx) => {
      const stopIds = trip.stops.map((s) => s.id);
      if (stopIds.length) {
        await tx.pod.deleteMany({ where: { stopId: { in: stopIds } } });
        await tx.tripStop.deleteMany({ where: { tripId: trip.id } });
      }

      await tx.tripStop.createMany({
        data: plan.map((s) => ({
          tripId: trip.id,
          seq: s.seq,
          type: s.type === 'DROPOFF' ? StopType.DROPOFF : StopType.PICKUP,
          loadId: s.loadId,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        })),
      });

      await tx.loadRequest.update({
        where: { id: offer.loadId },
        data: { status: LoadStatus.BOOKED },
      });

      await tx.matchOffer.update({
        where: { id: offer.id },
        data: { tripId: trip.id },
      });

      await tx.tripEvent.create({
        data: {
          tripId: trip.id,
          toStatus: trip.status,
          actorId: shipperUserId,
          meta: {
            action: 'SHARED_JOIN',
            offerId: offer.id,
            loadId: offer.loadId,
            coLoadCount: existingLoadIds.length,
          },
        },
      });

      return tx.trip.findUniqueOrThrow({
        where: { id: trip.id },
        include: { stops: true, vehicle: true, driver: true },
      });
    });

    const hold = await this.payments.createEscrowHold({
      loadId: offer.loadId,
      tripId: updated.id,
      amountPaisa: offer.pricePaisa,
      idempotencyKey: `offer-hold:${offer.id}`,
    });

    await this.notify.push(
      shipperUserId,
      'Joined Shared trip',
      `Your load joined truck ${updated.vehicle?.regNo ?? ''} before departure`,
      { tripId: updated.id },
    );
    if (updated.driverId) {
      const driver = await this.prisma.driverProfile.findUnique({
        where: { id: updated.driverId },
      });
      if (driver?.userId) {
        await this.notify.push(
          driver.userId,
          'Co-load joined',
          'Another Shared load joined your ASSIGNED trip',
          { tripId: updated.id },
        );
      }
    }

    return {
      trip: updated,
      payment: hold.payment,
      checkout: hold.checkout,
      keyId: hold.keyId,
      offerId: offer.id,
      loadId: offer.loadId,
      joined: true,
      message: `Joined open Shared trip before start (${hold.payment.gatewayProvider})`,
    };
  }

  async getReturnOffers(tripId: string) {
    const f = await this.flags.isEnabled('mode.return.enabled', false);
    if (!f.enabled) throw new BadRequestException('Return mode disabled');

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { stops: true, corridor: true, vehicle: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (
      ![
        TripStatus.IN_TRANSIT,
        TripStatus.AT_DROPOFF,
        TripStatus.DELIVERED,
      ].includes(trip.status as 'IN_TRANSIT')
    ) {
      // allow IN_TRANSIT, AT_DROPOFF
      if (
        trip.status !== TripStatus.IN_TRANSIT &&
        trip.status !== TripStatus.AT_DROPOFF
      ) {
        throw new BadRequestException(
          'Return offers open near delivery (IN_TRANSIT / AT_DROPOFF)',
        );
      }
    }

    const lastDrop = [...trip.stops]
      .filter((s) => s.type === StopType.DROPOFF)
      .sort((a, b) => b.seq - a.seq)[0];
    if (!lastDrop) throw new BadRequestException('No dropoff stop');

    // Prefer loads that start near dropoff and head back toward corridor origin (empty-mile fill).
    const homeLat = trip.corridor
      ? // approximate: Mumbai hub if BOM else first pickup of trip
        trip.stops.find((s) => s.type === StopType.PICKUP)?.lat ?? lastDrop.lat
      : lastDrop.lat;
    const homeLng =
      trip.stops.find((s) => s.type === StopType.PICKUP)?.lng ?? lastDrop.lng;

    await this.prisma.matchOffer.deleteMany({
      where: {
        vehicleId: trip.vehicleId ?? undefined,
        tripId: null,
        expiresAt: { lt: new Date() },
      },
    });

    const reverseLoads = await this.prisma.loadRequest.findMany({
      where: {
        mode: { in: [LoadMode.RETURN, LoadMode.DEDICATED, LoadMode.SHARED] },
        status: { in: [LoadStatus.OPEN, LoadStatus.MATCHING] },
      },
      take: 80,
    });

    const capacityKg = trip.vehicle?.capacityKg ?? 5000;
    const capacityCft = trip.vehicle?.capacityCft ?? 800;
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
    const scored: Array<{
      load: (typeof reverseLoads)[0];
      dist: number;
      towardHome: number;
      score: number;
      pricePaisa: number;
    }> = [];

    for (const load of reverseLoads) {
      if (load.weightKg > capacityKg || load.volumeCft > capacityCft) continue;
      const dist = haversineKm(
        lastDrop.lat,
        lastDrop.lng,
        load.originLat,
        load.originLng,
      );
      if (dist > 280) continue; // demo corridors need a wider empty-mile radius
      const afterDropToHome = haversineKm(
        load.destLat,
        load.destLng,
        homeLat,
        homeLng,
      );
      const directHome = haversineKm(lastDrop.lat, lastDrop.lng, homeLat, homeLng);
      const towardHome = Math.max(0, directHome - afterDropToHome);
      const detour = dist + afterDropToHome - directHome;
      const score = dist * 0.45 + Math.max(0, detour) * 0.35 - towardHome * 0.2;
      const pricePaisa = Math.round(
        220000 + dist * 1800 + load.weightKg * 20 - towardHome * 400,
      );
      scored.push({
        load,
        dist,
        towardHome,
        score,
        pricePaisa: Math.max(150000, pricePaisa),
      });
    }

    scored.sort((a, b) => a.score - b.score);
    const offers = [];
    for (const row of scored.slice(0, 8)) {
      const offer = await this.prisma.matchOffer.create({
        data: {
          loadId: row.load.id,
          vehicleId: trip.vehicleId,
          pricePaisa: row.pricePaisa,
          score: row.score,
          expiresAt,
          priceBreakdown: {
            type: 'RETURN',
            fromTripId: tripId,
            distKm: Number(row.dist.toFixed(1)),
            towardHomeKm: Number(row.towardHome.toFixed(1)),
            emptyMileScore: Number(row.score.toFixed(2)),
            origin: row.load.originAddress,
            dest: row.load.destAddress,
            regNo: trip.vehicle?.regNo,
          },
        },
      });
      offers.push(offer);
    }

    return { tripId, offers, homeHint: { lat: homeLat, lng: homeLng } };
  }

  /** Driver accepts a return-load offer near end of current trip. */
  async acceptReturnOffer(offerId: string, driverUserId: string) {
    const offer = await this.prisma.matchOffer.findUnique({
      where: { id: offerId },
      include: { load: { include: { shipper: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.expiresAt < new Date()) throw new BadRequestException('Offer expired');
    if (offer.tripId) throw new BadRequestException('Offer already taken');

    const breakdown = (offer.priceBreakdown ?? {}) as Record<string, unknown>;
    if (breakdown.type !== 'RETURN') {
      throw new BadRequestException('Not a return offer');
    }
    const fromTripId = breakdown.fromTripId as string | undefined;
    if (!fromTripId || !offer.vehicleId) {
      throw new BadRequestException('Invalid return offer');
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
    });
    if (!driver) throw new BadRequestException('Driver profile required');

    const fromTrip = await this.prisma.trip.findUnique({
      where: { id: fromTripId },
    });
    if (!fromTrip || fromTrip.driverId !== driver.id) {
      throw new BadRequestException('Return offer is not for your trip');
    }
    if (fromTrip.vehicleId !== offer.vehicleId) {
      throw new BadRequestException('Vehicle mismatch');
    }

    const load = offer.load;
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          mode: LoadMode.RETURN,
          status: TripStatus.ASSIGNED,
          vehicleId: offer.vehicleId!,
          driverId: driver.id,
          corridorId: load.corridorId,
          events: {
            create: {
              toStatus: TripStatus.ASSIGNED,
              actorId: driverUserId,
              meta: { offerId: offer.id, fromTripId, type: 'RETURN' },
            },
          },
          stops: {
            create: [
              {
                seq: 1,
                type: StopType.PICKUP,
                loadId: load.id,
                address: load.originAddress,
                lat: load.originLat,
                lng: load.originLng,
              },
              {
                seq: 2,
                type: StopType.DROPOFF,
                loadId: load.id,
                address: load.destAddress,
                lat: load.destLat,
                lng: load.destLng,
              },
            ],
          },
        },
        include: { stops: true, vehicle: true, driver: true },
      });

      await tx.matchOffer.update({
        where: { id: offer.id },
        data: { tripId: created.id },
      });
      await tx.loadRequest.update({
        where: { id: load.id },
        data: { status: LoadStatus.BOOKED, mode: LoadMode.RETURN },
      });
      return created;
    });

    const payment = await this.payments.createEscrowHold({
      loadId: load.id,
      tripId: trip.id,
      amountPaisa: offer.pricePaisa,
      idempotencyKey: `return-hold:${offer.id}`,
    });

    await this.notify.push(
      load.shipper.userId,
      'Return truck assigned',
      `Return load booked on trip ${trip.id.slice(0, 8)}`,
      { tripId: trip.id },
    );

    return {
      trip,
      payment: payment.payment,
      checkout: payment.checkout,
      offerId: offer.id,
      fromTripId,
      message: 'Return load assigned (starts after you finish current dropoff)',
    };
  }

  private async buildDedicatedOrReturnOffers(load: {
    id: string;
    mode: LoadMode;
    corridorId: string | null;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    weightKg: number;
    volumeCft: number;
  }) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        active: true,
        kycStatus: KycStatus.VERIFIED,
        capacityKg: { gte: load.weightKg },
        capacityCft: { gte: load.volumeCft },
        driverId: { not: null },
        driver: { kycStatus: KycStatus.VERIFIED },
      },
      include: { driver: true },
    });

    const rateCard = load.corridorId
      ? await this.prisma.rateCard.findFirst({
          where: { corridorId: load.corridorId, active: true },
          orderBy: { version: 'desc' },
        })
      : null;

    const basePaisa = rateCard?.basePaisa ?? 450000;
    const corridorKm = haversineKm(
      load.originLat,
      load.originLng,
      load.destLat,
      load.destLng,
    );
    const hubLat = 19.076;
    const hubLng = 72.8777;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const discount = load.mode === LoadMode.RETURN ? 0.75 : 1;

    const created = [];
    for (const vehicle of vehicles) {
      const active = await this.prisma.trip.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: {
            notIn: [
              TripStatus.SETTLED,
              TripStatus.CANCELLED,
              TripStatus.DELIVERED,
            ],
          },
        },
      });
      if (active) continue;

      const pickupKm = haversineKm(
        hubLat,
        hubLng,
        load.originLat,
        load.originLng,
      );
      const dedicatedPaisa =
        basePaisa +
        Math.round(corridorKm * (rateCard?.perKmPaisa ?? 2500)) +
        Math.round(load.weightKg * (rateCard?.perKgPaisa ?? 50));
      const pricePaisa = Math.round(dedicatedPaisa * discount);
      const rating = vehicle.driver?.ratingAvg ?? 5;
      const score =
        0.45 * pickupKm + 0.25 * (6 - rating) + 0.2 * (pricePaisa / 100000);

      created.push(
        await this.prisma.matchOffer.create({
          data: {
            loadId: load.id,
            vehicleId: vehicle.id,
            pricePaisa,
            score,
            expiresAt,
            priceBreakdown: {
              basePaisa,
              dedicatedPaisa,
              corridorKm: Number(corridorKm.toFixed(1)),
              pickupKm: Number(pickupKm.toFixed(1)),
              vehicleType: vehicle.type,
              regNo: vehicle.regNo,
              rating,
              mode: load.mode,
            },
          },
        }),
      );
    }

    created.sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
    return { loadId: load.id, mode: load.mode, offers: created };
  }

  private async buildSharedOffers(load: {
    id: string;
    mode?: LoadMode;
    corridorId: string | null;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    weightKg: number;
    volumeCft: number;
    cargoType: string;
    windowStart: Date;
    windowEnd: Date;
    createdAt?: Date;
  }) {
    const peers = await this.prisma.loadRequest.findMany({
      where: {
        id: { not: load.id },
        mode: LoadMode.SHARED,
        status: { in: [LoadStatus.OPEN, LoadStatus.MATCHING] },
        corridorId: load.corridorId ?? undefined,
      },
      take: 30,
    });

    const compatible = peers.filter((p) => {
      const bad = INCOMPATIBLE[load.cargoType.toLowerCase()] ?? [];
      if (bad.includes(p.cargoType.toLowerCase())) return false;
      const overlap =
        p.windowStart <= load.windowEnd && p.windowEnd >= load.windowStart;
      return overlap;
    });

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        active: true,
        kycStatus: KycStatus.VERIFIED,
        driverId: { not: null },
        driver: { kycStatus: KycStatus.VERIFIED },
      },
      include: { driver: true },
    });

    const rateCard = load.corridorId
      ? await this.prisma.rateCard.findFirst({
          where: { corridorId: load.corridorId, active: true },
          orderBy: { version: 'desc' },
        })
      : null;
    const basePaisa = rateCard?.basePaisa ?? 450000;
    const corridorKm = haversineKm(
      load.originLat,
      load.originLng,
      load.destLat,
      load.destLng,
    );
    const dedicatedVehiclePaisa =
      basePaisa +
      Math.round(corridorKm * (rateCard?.perKmPaisa ?? 2500)) +
      Math.round(load.weightKg * (rateCard?.perKgPaisa ?? 50));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const created = [];
    const wait = this.sharedWaitMeta({
      mode: LoadMode.SHARED,
      createdAt: load.createdAt,
    });
    const primaryFull = await this.prisma.loadRequest.findUnique({
      where: { id: load.id },
    });

    for (const vehicle of vehicles) {
      const active = await this.prisma.trip.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: {
            notIn: [
              TripStatus.SETTLED,
              TripStatus.CANCELLED,
              TripStatus.DELIVERED,
            ],
          },
        },
        include: {
          stops: { include: { pod: true } },
        },
      });

      // Join open Shared trip before driver starts (ASSIGNED, no PODs yet).
      if (active) {
        if (
          active.mode === LoadMode.SHARED &&
          SHARED_JOINABLE.includes(active.status) &&
          !active.stops.some((s) => s.pod?.passed) &&
          (!active.corridorId ||
            !load.corridorId ||
            active.corridorId === load.corridorId)
        ) {
          const onTripIds = [
            ...new Set(
              active.stops
                .map((s) => s.loadId)
                .filter((id): id is string => !!id),
            ),
          ];
          if (onTripIds.includes(load.id)) continue;

          const onTripLoads = await this.prisma.loadRequest.findMany({
            where: { id: { in: onTripIds } },
          });
          const packed: GeoLoad[] = [
            ...onTripLoads.map((l) => ({
              id: l.id,
              weightKg: l.weightKg,
              volumeCft: l.volumeCft,
              originLat: l.originLat,
              originLng: l.originLng,
              destLat: l.destLat,
              destLng: l.destLng,
              originAddress: l.originAddress,
              destAddress: l.destAddress,
            })),
            {
              id: load.id,
              weightKg: load.weightKg,
              volumeCft: load.volumeCft,
              originLat: load.originLat,
              originLng: load.originLng,
              destLat: load.destLat,
              destLng: load.destLng,
              originAddress: primaryFull?.originAddress ?? 'Origin',
              destAddress: primaryFull?.destAddress ?? 'Destination',
            },
          ];
          const totalW = packed.reduce((s, x) => s + x.weightKg, 0);
          const totalV = packed.reduce((s, x) => s + x.volumeCft, 0);
          if (totalW > vehicle.capacityKg || totalV > vehicle.capacityCft) {
            continue;
          }

          const coLoads = packed.filter((p) => p.id !== load.id);
          const sharedDiscount = Math.min(0.4, 0.18 + coLoads.length * 0.08);
          const poolDedicated =
            basePaisa +
            Math.round(corridorKm * (rateCard?.perKmPaisa ?? 2500)) +
            Math.round(totalW * (rateCard?.perKgPaisa ?? 50));
          const splits = splitSharedPrices(
            packed,
            poolDedicated,
            sharedDiscount,
          );
          const mySplit = splits.find((s) => s.loadId === load.id)!;
          const pricePaisa = mySplit.pricePaisa;
          const stopPlan = buildSharedStopPlan(packed);
          const rating = vehicle.driver?.ratingAvg ?? 5;
          const routeKm = routeLengthKm(stopPlan);

          created.push(
            await this.prisma.matchOffer.create({
              data: {
                loadId: load.id,
                vehicleId: vehicle.id,
                pricePaisa,
                score: pricePaisa / 100000 + (5 - rating) * 0.05,
                expiresAt,
                priceBreakdown: {
                  mode: 'SHARED',
                  joinTripId: active.id,
                  joinBeforeStart: true,
                  splitMethod: 'weight_x_distance',
                  dedicatedPaisa: dedicatedVehiclePaisa,
                  poolDedicatedPaisa: poolDedicated,
                  sharedDiscount: Number(sharedDiscount.toFixed(2)),
                  coLoadCount: coLoads.length,
                  coLoadIds: coLoads.map((c) => c.id),
                  priceSplits: splits,
                  stopPlan,
                  routeKm: Number(routeKm.toFixed(1)),
                  regNo: vehicle.regNo,
                  rating,
                  etaRangeMin: 6 + coLoads.length * 2,
                  etaRangeMax: 12 + coLoads.length * 4,
                  kmSaved: Math.max(
                    0,
                    Math.round(corridorKm * coLoads.length * 0.35),
                  ),
                  co2KgProxy: Math.max(0, coLoads.length * 11),
                  inrSaved: Math.round(
                    Math.max(0, dedicatedVehiclePaisa - pricePaisa) / 100,
                  ),
                  soloShared: false,
                },
              },
            }),
          );
        }
        continue;
      }

      const packed: GeoLoad[] = [
        {
          id: load.id,
          weightKg: load.weightKg,
          volumeCft: load.volumeCft,
          originLat: load.originLat,
          originLng: load.originLng,
          destLat: load.destLat,
          destLng: load.destLng,
          originAddress: primaryFull?.originAddress ?? 'Origin',
          destAddress: primaryFull?.destAddress ?? 'Destination',
        },
      ];
      for (const peer of compatible.sort((a, b) => b.weightKg - a.weightKg)) {
        const w = packed.reduce((s, x) => s + x.weightKg, 0) + peer.weightKg;
        const v = packed.reduce((s, x) => s + x.volumeCft, 0) + peer.volumeCft;
        if (w <= vehicle.capacityKg && v <= vehicle.capacityCft) {
          packed.push({
            id: peer.id,
            weightKg: peer.weightKg,
            volumeCft: peer.volumeCft,
            originLat: peer.originLat,
            originLng: peer.originLng,
            destLat: peer.destLat,
            destLng: peer.destLng,
            originAddress: peer.originAddress,
            destAddress: peer.destAddress,
          });
        }
      }

      const coLoads = packed.filter((p) => p.id !== load.id);
      const sharedDiscount = Math.min(0.4, 0.18 + coLoads.length * 0.08);
      // Pool ≈ dedicated for this vehicle/corridor sized to packed weight
      const poolDedicated =
        basePaisa +
        Math.round(corridorKm * (rateCard?.perKmPaisa ?? 2500)) +
        Math.round(
          packed.reduce((s, p) => s + p.weightKg, 0) *
            (rateCard?.perKgPaisa ?? 50),
        );
      const splits = splitSharedPrices(packed, poolDedicated, sharedDiscount);
      const mySplit = splits.find((s) => s.loadId === load.id)!;
      const pricePaisa = mySplit.pricePaisa;
      const stopPlan = buildSharedStopPlan(packed);
      const rating = vehicle.driver?.ratingAvg ?? 5;
      const routeKm = routeLengthKm(stopPlan);

      created.push(
        await this.prisma.matchOffer.create({
          data: {
            loadId: load.id,
            vehicleId: vehicle.id,
            pricePaisa,
            score: pricePaisa / 100000 + (5 - rating) * 0.1,
            expiresAt,
            priceBreakdown: {
              mode: 'SHARED',
              splitMethod: 'weight_x_distance',
              dedicatedPaisa: dedicatedVehiclePaisa,
              poolDedicatedPaisa: poolDedicated,
              sharedDiscount: Number(sharedDiscount.toFixed(2)),
              coLoadCount: coLoads.length,
              coLoadIds: coLoads.map((c) => c.id),
              priceSplits: splits,
              stopPlan,
              routeKm: Number(routeKm.toFixed(1)),
              regNo: vehicle.regNo,
              rating,
              etaRangeMin: 6 + coLoads.length * 2,
              etaRangeMax: 12 + coLoads.length * 4,
              kmSaved: Math.max(0, Math.round(corridorKm * coLoads.length * 0.35)),
              co2KgProxy: Math.max(0, coLoads.length * 11),
              inrSaved: Math.round(
                Math.max(0, dedicatedVehiclePaisa - pricePaisa) / 100,
              ),
              soloShared: coLoads.length === 0,
            },
          },
        }),
      );
    }

    created.sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
    return {
      loadId: load.id,
      mode: LoadMode.SHARED,
      offers: created,
      ...wait,
    };
  }

  private async ensureDemoSupply() {
    const seeds = [
      {
        phone: '9000000001',
        name: 'Demo Driver',
        regNo: 'MH12SH0001',
        license: 'MH-DEMO-DL',
      },
      {
        phone: '9000000002',
        name: 'Demo Driver 2',
        regNo: 'MH12SH0002',
        license: 'MH-DEMO-DL2',
      },
      {
        phone: '9000000003',
        name: 'Demo Driver 3',
        regNo: 'MH12SH0003',
        license: 'MH-DEMO-DL3',
      },
    ];

    for (const seed of seeds) {
      const existing = await this.prisma.vehicle.findUnique({
        where: { regNo: seed.regNo },
      });
      if (existing) continue;

      let user = await this.prisma.user.findUnique({
        where: { phone: seed.phone },
      });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            phone: seed.phone,
            name: seed.name,
            roles: { create: { role: UserRole.DRIVER } },
            driverProfile: {
              create: {
                licenseNo: seed.license,
                kycStatus: KycStatus.VERIFIED,
                ratingAvg: 4.7,
              },
            },
          },
        });
      }

      const driver = await this.prisma.driverProfile.findUnique({
        where: { userId: user.id },
      });
      if (!driver) continue;
      if (driver.kycStatus !== KycStatus.VERIFIED) {
        await this.prisma.driverProfile.update({
          where: { id: driver.id },
          data: { kycStatus: KycStatus.VERIFIED },
        });
      }
      await this.prisma.vehicle.create({
        data: {
          regNo: seed.regNo,
          type: 'truck_14ft',
          capacityKg: 5000,
          capacityCft: 800,
          kycStatus: KycStatus.VERIFIED,
          driverId: driver.id,
          active: true,
        },
      });
    }
  }
}
