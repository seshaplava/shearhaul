export const INTEGRATION_TOKENS = {
  SMS: 'SMS_PROVIDER',
  STORAGE: 'STORAGE_PROVIDER',
  PAYMENT_GATEWAY: 'PAYMENT_GATEWAY',
  PUSH: 'PUSH_PROVIDER',
  MAPS: 'MAPS_PROVIDER',
  KYC: 'KYC_PROVIDER',
  PDF: 'PDF_PROVIDER',
} as const;

export interface SmsProvider {
  readonly name: string;
  sendOtp(phone: string, code: string): Promise<{ sent: boolean; providerRef?: string }>;
}

export interface StorageProvider {
  readonly name: string;
  createUploadUrl(params: {
    key: string;
    contentType: string;
    expiresSec?: number;
  }): Promise<{
    uploadUrl: string;
    key: string;
    publicOrSignedGetUrl?: string;
    headers?: Record<string, string>;
  }>;
  createDownloadUrl(key: string, expiresSec?: number): Promise<string>;
  putObject(key: string, body: Buffer, contentType: string): Promise<{ key: string }>;
}

export interface PaymentGateway {
  readonly name: string;
  createHoldOrder(params: {
    amountPaisa: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{
    orderId: string;
    amountPaisa: number;
    currency: string;
    keyId?: string;
    checkout?: Record<string, unknown>;
  }>;
  capture(params: {
    paymentId: string;
    amountPaisa: number;
  }): Promise<{ captured: boolean; paymentId: string; raw?: unknown }>;
  createPayout(params: {
    amountPaisa: number;
    reference: string;
    notes?: Record<string, string>;
  }): Promise<{ payoutId: string; status: string }>;
  verifyWebhookSignature?(rawBody: string, signature: string): boolean;
}

export interface PushProvider {
  readonly name: string;
  send(params: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<{ successCount: number }>;
}

export interface MapsProvider {
  readonly name: string;
  distanceKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ): Promise<number>;
  staticMapUrl?(params: {
    lat: number;
    lng: number;
    zoom?: number;
  }): string | null;
}

export interface KycProvider {
  readonly name: string;
  verifyDocument(params: {
    docType: string;
    storageKey: string;
    userId: string;
  }): Promise<{
    status: 'VERIFIED' | 'REJECTED' | 'IN_REVIEW';
    score?: number;
    notes?: string;
    vendorRef?: string;
  }>;
}

export interface PdfProvider {
  readonly name: string;
  generateLr(params: {
    tripId: string;
    from: string;
    to: string;
    vehicleReg?: string;
    weightKg?: number;
  }): Promise<Buffer>;
  generateInvoice(params: {
    tripId: string;
    amountPaisa: number;
    shipperName?: string;
  }): Promise<Buffer>;
}
