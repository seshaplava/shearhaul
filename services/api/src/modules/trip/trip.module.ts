import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PaymentModule } from '../payment/payment.module';
import { TripController } from './trip.controller';
import { TripService } from './trip.service';

@Module({
  imports: [IdentityModule, PaymentModule],
  controllers: [TripController],
  providers: [TripService],
  exports: [TripService],
})
export class TripModule {}
