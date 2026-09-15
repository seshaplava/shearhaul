import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PaymentService } from './payment.service';

class ConfirmPaymentDto {
  @IsOptional()
  @IsString()
  paymentIntentId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsString()
  gatewayPaymentId!: string;
}

@Controller('payments')
class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('hold/:offerId')
  @UseGuards(JwtAuthGuard)
  holdPreview(@Param('offerId') offerId: string) {
    return this.payments.holdPreview(offerId);
  }

  @Get('trip/:tripId')
  @UseGuards(JwtAuthGuard)
  byTrip(@Param('tripId') tripId: string) {
    return this.payments.getByTrip(tripId);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  confirm(@Body() dto: ConfirmPaymentDto) {
    return this.payments.confirmPayment(dto);
  }

  @Post('trip/:tripId/mock-confirm')
  @UseGuards(JwtAuthGuard)
  mockConfirm(@Param('tripId') tripId: string) {
    return this.payments.autoConfirmMock(tripId);
  }

  /** Razorpay webhooks — no JWT; signature verified. */
  @Post('webhooks/razorpay')
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    const raw =
      req.rawBody?.toString('utf8') ??
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    return this.payments.handleRazorpayWebhook(raw, signature);
  }
}

@Module({
  imports: [IdentityModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
