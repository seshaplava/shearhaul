import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { LoadController } from './load.controller';
import { LoadService } from './load.service';

@Module({
  imports: [IdentityModule, FeatureFlagsModule],
  controllers: [LoadController],
  providers: [LoadService],
  exports: [LoadService],
})
export class LoadModule {}
