import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-sharehaul-secret-change-me'),
        signOptions: {
          expiresIn: Number(config.get('JWT_EXPIRES_SEC') ?? 60 * 60 * 24 * 7),
        },
      }),
    }),
  ],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService, JwtModule],
})
export class IdentityModule {}
