import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { LoadModule } from './modules/load/load.module';
import { MatchingModule } from './modules/matching/matching.module';
import { TripModule } from './modules/trip/trip.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { PaymentModule } from './modules/payment/payment.module';
import { KycModule } from './modules/kyc/kyc.module';
import { NotificationModule } from './modules/notification/notification.module';
import { DocumentModule } from './modules/document/document.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminBffModule } from './modules/admin-bff/admin-bff.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { InsuranceModule } from './modules/insurance/insurance.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IntegrationsModule,
    HealthModule,
    IdentityModule,
    FeatureFlagsModule,
    CatalogModule,
    LoadModule,
    MatchingModule,
    TripModule,
    TrackingModule,
    PaymentModule,
    KycModule,
    NotificationModule,
    DocumentModule,
    ClaimsModule,
    AnalyticsModule,
    AdminBffModule,
    I18nModule,
    RatingsModule,
    InsuranceModule,
  ],
})
export class AppModule {}
