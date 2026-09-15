import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';
import Razorpay from 'razorpay';
import type { PaymentGateway } from '../ports';

type RazorpayClient = {
  orders: {
    create: (data: Record<string, unknown>) => Promise<{ id: string }>;
  };
  payments: {
    capture: (
      paymentId: string,
      amount: number,
      currency: string,
    ) => Promise<unknown>;
  };
};

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock';

  async createHoldOrder(params: {
    amountPaisa: number;
    receipt: string;
    notes?: Record<string, string>;
  }) {
    const orderId = `order_mock_${randomUUID().slice(0, 8)}`;
    return {
      orderId,
      amountPaisa: params.amountPaisa,
      currency: 'INR',
      keyId: 'rzp_test_mock',
      checkout: {
        provider: 'mock',
        order_id: orderId,
        amount: params.amountPaisa,
        currency: 'INR',
        autoConfirm: true,
        message: 'Mock escrow — no real charge. Confirm via API.',
      },
    };
  }

  async capture(params: { paymentId: string; amountPaisa: number }) {
    return { captured: true, paymentId: params.paymentId };
  }

  async createPayout(params: {
    amountPaisa: number;
    reference: string;
  }) {
    return {
      payoutId: `payout_mock_${params.reference.slice(0, 8)}`,
      status: 'PAID',
    };
  }

  verifyWebhookSignature() {
    return true;
  }
}

@Injectable()
export class RazorpayPaymentGateway implements PaymentGateway {
  readonly name = 'razorpay';
  private readonly log = new Logger(RazorpayPaymentGateway.name);
  private client: RazorpayClient | null = null;
  private readonly keyId: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.keyId = config.get<string>('RAZORPAY_KEY_ID') ?? '';
    const keySecret = config.get<string>('RAZORPAY_KEY_SECRET') ?? '';
    this.webhookSecret = config.get<string>('RAZORPAY_WEBHOOK_SECRET') ?? '';
    if (this.keyId && keySecret) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client = new (Razorpay as any)({
        key_id: this.keyId,
        key_secret: keySecret,
      }) as RazorpayClient;
    } else {
      this.log.warn('RAZORPAY_KEY_ID/SECRET missing — gateway not initialized');
    }
  }

  private assertClient() {
    if (!this.client) {
      throw new Error(
        'Razorpay not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET',
      );
    }
    return this.client;
  }

  async createHoldOrder(params: {
    amountPaisa: number;
    receipt: string;
    notes?: Record<string, string>;
  }) {
    if (!this.keyId) throw new Error('RAZORPAY_KEY_ID missing');
    const order = await this.assertClient().orders.create({
      amount: params.amountPaisa,
      currency: 'INR',
      receipt: params.receipt.slice(0, 40),
      payment_capture: false,
      notes: params.notes,
    });
    return {
      orderId: String(order.id),
      amountPaisa: params.amountPaisa,
      currency: 'INR',
      keyId: this.keyId,
      checkout: {
        provider: 'razorpay',
        key: this.keyId,
        amount: params.amountPaisa,
        currency: 'INR',
        order_id: order.id,
        name: 'ShareHaul',
        description: 'Freight escrow hold',
        theme: { color: '#0B6E4F' },
      },
    };
  }

  async capture(params: { paymentId: string; amountPaisa: number }) {
    const payment = await this.assertClient().payments.capture(
      params.paymentId,
      params.amountPaisa,
      'INR',
    );
    this.log.log(`Captured ${params.paymentId}`);
    return {
      captured: true,
      paymentId: params.paymentId,
      raw: payment,
    };
  }

  async createPayout(params: {
    amountPaisa: number;
    reference: string;
    notes?: Record<string, string>;
  }) {
    // RazorpayX payouts need a funded account + contact/fund account.
    // Until RAZORPAYX_* is set, record a pending payout reference.
    const accountNumber = this.config.get('RAZORPAYX_ACCOUNT_NUMBER');
    if (!accountNumber) {
      return {
        payoutId: `pending_x_${params.reference.slice(0, 8)}`,
        status: 'PENDING',
      };
    }
    // Minimal placeholder — wire full RazorpayX contacts in ops setup.
    return {
      payoutId: `rzpx_${params.reference.slice(0, 12)}`,
      status: 'PROCESSING',
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string) {
    if (!this.webhookSecret) return false;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return expected === signature;
  }
}
