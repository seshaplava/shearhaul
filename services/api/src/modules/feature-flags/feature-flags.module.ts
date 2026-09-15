import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  list() {
    return this.flags.list();
  }

  @Get(':key')
  isEnabled(@Param('key') key: string, @Query('default') def?: string) {
    return this.flags.isEnabled(key, def === 'true');
  }
}

@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
