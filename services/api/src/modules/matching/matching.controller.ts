import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { MatchingService } from './matching.service';

@Controller()
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get('loads/:id/offers')
  @UseGuards(JwtAuthGuard)
  offers(@Param('id') id: string) {
    return this.matching.getOffers(id);
  }

  @Post('offers/:id/select')
  @UseGuards(JwtAuthGuard)
  select(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.matching.selectOffer(id, user.userId);
  }

  @Get('trips/:id/return-offers')
  @UseGuards(JwtAuthGuard)
  returnOffers(@Param('id') id: string) {
    return this.matching.getReturnOffers(id);
  }

  @Post('offers/:id/accept-return')
  @UseGuards(JwtAuthGuard)
  acceptReturn(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.matching.acceptReturnOffer(id, user.userId);
  }

  @Post('loads/:id/convert-dedicated')
  @UseGuards(JwtAuthGuard)
  convertDedicated(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.matching.convertSharedToDedicated(id, user.userId);
  }
}
