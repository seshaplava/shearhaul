import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { IngestTrackingDto, TrackingService } from './tracking.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('tracking/points')
  ingest(@CurrentUser() user: AuthUser, @Body() dto: IngestTrackingDto) {
    return this.tracking.ingest(user.userId, user.roles, dto);
  }

  @Get('trips/:id/location')
  location(@Param('id') id: string) {
    return this.tracking.latestLocation(id);
  }
}
