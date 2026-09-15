import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomUUID } from 'crypto';
import {
  INTEGRATION_TOKENS,
  type PaymentGateway,
} from '../../integrations/ports';

@Injectable()
export class PaymentService {
  private readonly log = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRATION_TOKENS.PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
  ) {}

  /** Create escrow hold order (Razorpay authorize or mock immediate HELD). */
  async createEscrowHold(params: {
    loadId: string;
    tripId: string;
    amountPaisa: number;
    idempotencyKey: string;
  }) {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return {
        payment: existing,
        checkout: existing.gatewayOrderId
          ? {
              order_id: existing.gatewayOrderId,
              amount: existing.amountPaisa,
              provider: existing.gatewayProvider,
            }
          : undefined,
      };
    }

    const order = await this.gateway.createHoldOrder({
      amountPaisa: params.amountPaisa,
      receipt: params.idempotencyKey,
      notes: { loadId: params.loadId, tripId: params.tripId },
    });

    const isMock = this.gateway.name === 'mock';
    const payment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.paymentIntent.create({
        data: {
          loadId: params.loadId,
          tripId: params.tripId,
          amountPaisa: params.amountPaisa,
          status: isMock ? PaymentStatus.HELD : PaymentStatus.CREATED,
          gatewayOrderId: order.orderId,
          gatewayProvider: this.gateway.name,
          idempotencyKey: params.idempotencyKey,
        },
      });
      if (isMock) {
        await tx.ledgerEntry.create({
          data: {
            paymentId: row.id,
            account: 'SHIPPER_ESCROW',
            direction: 'CREDIT',
            amountPaisa: params.amountPaisa,
            refType: 'PAYMENT_HOLD',
            refId: row.id,
            idempotencyKey: `hold:${params.idempotencyKey}`,
          },
        });
      }
      return row;
    });

    return { payment, checkout: order.checkout, keyId: order.keyId };
  }

  /** @deprecated alias — matching still calls mockHold */
  async mockHold(params: {
    loadId: string;
    tripId: string;
    amountPaisa: number;
    idempotencyKey: string;
  }) {
    const res = await this.createEscrowHold(params);
    return res.payment;
  }

  async confirmPayment(params: {
    paymentIntentId?: string;
    orderId?: string;
    gatewayPaymentId: string;
  }) {
    const payment = await this.prisma.paymentIntent.findFirst({
      where: params.paymentIntentId
        ? { id: params.paymentIntentId }
        : { gatewayOrderId: params.orderId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.HELD) return payment;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentIntent.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.HELD,
          gatewayPaymentId: params.gatewayPaymentId,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          account: 'SHIPPER_ESCROW',
          direction: 'CREDIT',
          amountPaisa: payment.amountPaisa,
          refType: 'PAYMENT_HOLD',
          refId: payment.id,
          idempotencyKey: `hold:confirm:${payment.id}`,
        },
      });
      return updated;
    });
  }

  async handleRazorpayWebhook(rawBody: string, signature: string | undefined) {
    if (
      this.gateway.verifyWebhookSignature &&
      signature &&
      !this.gateway.verifyWebhookSignature(rawBody, signature)
    ) {
      throw new BadRequestException('Invalid webhook signature');
    }
    const event = JSON.parse(rawBody) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: { id?: string; order_id?: string; status?: string };
        };
      };
    };
    const entity = event.payload?.payment?.entity;
    if (!entity?.order_id || !entity.id) {
      return { ok: true, ignored: true };
    }
    if (
      event.event === 'payment.authorized' ||
      event.event === 'payment.captured' ||
      entity.status === 'authorized' ||
      entity.status === 'captured'
    ) {
      await this.confirmPayment({
        orderId: entity.order_id,
        gatewayPaymentId: entity.id,
      });
    }
    return { ok: true, event: event.event };
  }

  async settleTrip(tripId: string) {
    const payment = await this.prisma.paymentIntent.findFirst({
      where: {
        tripId,
        status: { in: [PaymentStatus.HELD, PaymentStatus.CREATED] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      throw new NotFoundException('No held payment for trip');
    }

    if (
      payment.status === PaymentStatus.CREATED &&
      this.gateway.name !== 'mock'
    ) {
      throw new BadRequestException('Payment not authorized yet');
    }

    if (payment.gatewayPaymentId && this.gateway.name === 'razorpay') {
      try {
        await this.gateway.capture({
          paymentId: payment.gatewayPaymentId,
          amountPaisa: payment.amountPaisa,
        });
      } catch (e) {
        this.log.warn(`Capture warn: ${e}`);
      }
    }

    const platformFee = Math.round(payment.amountPaisa * 0.08);
    const driverAmount = payment.amountPaisa - platformFee;

    return this.prisma.$transaction(async (tx) => {
      const captured = await tx.paymentIntent.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CAPTURED },
      });

      const ledger: Prisma.LedgerEntryCreateManyInput[] = [
        {
          paymentId: payment.id,
          account: 'SHIPPER_ESCROW',
          direction: 'DEBIT',
          amountPaisa: payment.amountPaisa,
          refType: 'PAYMENT_CAPTURE',
          refId: payment.id,
          idempotencyKey: `capture:${payment.id}`,
        },
        {
          paymentId: payment.id,
          account: 'PLATFORM_FEE',
          direction: 'CREDIT',
          amountPaisa: platformFee,
          refType: 'PLATFORM_FEE',
          refId: payment.id,
          idempotencyKey: `fee:${payment.id}`,
        },
        {
          paymentId: payment.id,
          account: 'DRIVER_PAYABLE',
          direction: 'CREDIT',
          amountPaisa: driverAmount,
          refType: 'DRIVER_PAYOUT',
          refId: payment.id,
          idempotencyKey: `driver:${payment.id}`,
        },
      ];
      await tx.ledgerEntry.createMany({ data: ledger });

      const payoutGw = await this.gateway.createPayout({
        amountPaisa: driverAmount,
        reference: payment.id,
      });

      await tx.payout.create({
        data: {
          paymentId: payment.id,
          beneficiary: 'DRIVER',
          amountPaisa: driverAmount,
          status:
            payoutGw.status === 'PAID'
              ? PayoutStatus.PAID
              : PayoutStatus.PENDING,
          gatewayRef: payoutGw.payoutId,
        },
      });

      return {
        payment: captured,
        platformFeePaisa: platformFee,
        driverPayoutPaisa: driverAmount,
        payout: payoutGw,
      };
    });
  }

  async getByTrip(tripId: string) {
    return this.prisma.paymentIntent.findMany({
      where: { tripId },
      include: { ledger: true, payouts: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async holdPreview(offerId: string) {
    const offer = await this.prisma.matchOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.expiresAt < new Date()) {
      throw new BadRequestException('Offer expired');
    }
    return {
      offerId,
      amountPaisa: offer.pricePaisa,
      currency: 'INR',
      provider: this.gateway.name,
      mode:
        this.gateway.name === 'razorpay'
          ? 'RAZORPAY_UPI_AUTH_HOLD'
          : 'MOCK_UPI_HOLD',
      message:
        this.gateway.name === 'razorpay'
          ? 'Select offer → open Razorpay Checkout → confirm payment'
          : 'Select offer to hold + assign (mock escrow)',
    };
  }

  /** Demo helper when using mock gateway — invent a payment id. */
  async autoConfirmMock(tripId: string) {
    const payment = await this.prisma.paymentIntent.findFirst({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.HELD) return payment;
    return this.confirmPayment({
      paymentIntentId: payment.id,
      gatewayPaymentId: `pay_mock_${randomUUID().slice(0, 8)}`,
    });
  }
}
