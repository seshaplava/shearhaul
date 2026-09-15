import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { SubmitPodDto, TripService } from './trip.service';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';

@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripController {
  constructor(private readonly trips: TripService) {}

  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.trips.listForDriver(user.userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.trips.getById(id);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.trips.accept(id, user.userId, user.roles);
  }

  @Post(':id/status')
  status(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTripStatusDto,
  ) {
    return this.trips.updateStatus(id, user.userId, user.roles, dto.status);
  }

  @Post(':id/pod')
  pod(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitPodDto,
  ) {
    return this.trips.submitPod(id, user.userId, user.roles, dto);
  }
}
