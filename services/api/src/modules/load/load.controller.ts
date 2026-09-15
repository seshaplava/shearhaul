import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { LoadService } from './load.service';
import { CreateLoadDto } from './dto/create-load.dto';

@Controller('loads')
@UseGuards(JwtAuthGuard)
export class LoadController {
  constructor(private readonly loads: LoadService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLoadDto) {
    return this.loads.create(user.userId, user.roles, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.loads.listForUser(user.userId, user.roles);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.loads.getById(id);
  }
}
