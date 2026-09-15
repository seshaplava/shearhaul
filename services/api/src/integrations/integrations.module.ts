import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityModule } from '../modules/identity/identity.module';
import { INTEGRATION_TOKENS } from './ports';
import { ConsoleSmsProvider, Msg91SmsProvider } from './sms/sms.providers';
import {
  LocalStorageProvider,
  AzureBlobStorageProvider,
  S3StorageProvider,
} from './storage/storage.providers';
import {
  MockPaymentGateway,
  RazorpayPaymentGateway,
} from './payments/payment.gateways';
import { DbOnlyPushProvider, FcmPushProvider } from './push/push.providers';
import {
  GoogleMapsProvider,
  HaversineMapsProvider,
} from './maps/maps.providers';
import {
  HypervergeKycProvider,
  ManualKycProvider,
} from './kyc/kyc.providers';
import { PdfKitProvider } from './pdf/pdf.provider';
import { IntegrationsController } from './integrations.controller';

function pick(config: ConfigService, key: string, fallback: string) {
  return (config.get<string>(key) ?? fallback).toLowerCase();
}

@Global()
@Module({
  imports: [IdentityModule],
  controllers: [IntegrationsController],
  providers: [
    ConsoleSmsProvider,
    Msg91SmsProvider,
    LocalStorageProvider,
    AzureBlobStorageProvider,
    S3StorageProvider,
    MockPaymentGateway,
    RazorpayPaymentGateway,
    DbOnlyPushProvider,
    FcmPushProvider,
    HaversineMapsProvider,
    GoogleMapsProvider,
    ManualKycProvider,
    HypervergeKycProvider,
    PdfKitProvider,
    {
      provide: INTEGRATION_TOKENS.SMS,
      inject: [ConfigService, ConsoleSmsProvider, Msg91SmsProvider],
      useFactory: (
        config: ConfigService,
        consoleSms: ConsoleSmsProvider,
        msg91: Msg91SmsProvider,
      ) =>
        pick(config, 'SMS_PROVIDER', 'console') === 'msg91'
          ? msg91
          : consoleSms,
    },
    {
      provide: INTEGRATION_TOKENS.STORAGE,
      inject: [
        ConfigService,
        LocalStorageProvider,
        AzureBlobStorageProvider,
        S3StorageProvider,
      ],
      useFactory: (
        config: ConfigService,
        local: LocalStorageProvider,
        azure: AzureBlobStorageProvider,
        s3: S3StorageProvider,
      ) => {
        const p = pick(config, 'STORAGE_PROVIDER', 'local');
        if (p === 'azure') return azure;
        if (p === 's3') return s3;
        return local;
      },
    },
    {
      provide: INTEGRATION_TOKENS.PAYMENT_GATEWAY,
      inject: [ConfigService, MockPaymentGateway, RazorpayPaymentGateway],
      useFactory: (
        config: ConfigService,
        mock: MockPaymentGateway,
        razorpay: RazorpayPaymentGateway,
      ) =>
        pick(config, 'PAYMENTS_PROVIDER', 'mock') === 'razorpay'
          ? razorpay
          : mock,
    },
    {
      provide: INTEGRATION_TOKENS.PUSH,
      inject: [ConfigService, DbOnlyPushProvider, FcmPushProvider],
      useFactory: (
        config: ConfigService,
        db: DbOnlyPushProvider,
        fcm: FcmPushProvider,
      ) => (pick(config, 'PUSH_PROVIDER', 'db') === 'fcm' ? fcm : db),
    },
    {
      provide: INTEGRATION_TOKENS.MAPS,
      inject: [ConfigService, HaversineMapsProvider, GoogleMapsProvider],
      useFactory: (
        config: ConfigService,
        haversine: HaversineMapsProvider,
        google: GoogleMapsProvider,
      ) =>
        pick(config, 'MAPS_PROVIDER', 'haversine') === 'google'
          ? google
          : haversine,
    },
    {
      provide: INTEGRATION_TOKENS.KYC,
      inject: [ConfigService, ManualKycProvider, HypervergeKycProvider],
      useFactory: (
        config: ConfigService,
        manual: ManualKycProvider,
        hv: HypervergeKycProvider,
      ) =>
        pick(config, 'KYC_PROVIDER', 'manual') === 'hyperverge' ? hv : manual,
    },
    {
      provide: INTEGRATION_TOKENS.PDF,
      useExisting: PdfKitProvider,
    },
  ],
  exports: [
    INTEGRATION_TOKENS.SMS,
    INTEGRATION_TOKENS.STORAGE,
    INTEGRATION_TOKENS.PAYMENT_GATEWAY,
    INTEGRATION_TOKENS.PUSH,
    INTEGRATION_TOKENS.MAPS,
    INTEGRATION_TOKENS.KYC,
    INTEGRATION_TOKENS.PDF,
    LocalStorageProvider,
  ],
})
export class IntegrationsModule {}
