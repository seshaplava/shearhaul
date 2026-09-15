import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PaymentModule } from '../payment/payment.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { NotificationModule } from '../notification/notification.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [
    IdentityModule,
    PaymentModule,
    FeatureFlagsModule,
    NotificationModule,
  ],
  controllers: [MatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
