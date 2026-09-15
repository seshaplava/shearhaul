import { Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { IdentityService } from './identity.service';

class RequestOtpDto {
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

class VerifyOtpDto {
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone!: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly jwt: JwtService,
  ) {}

  @Post('otp/request')
  requestOtp(@Body() body: RequestOtpDto) {
    return this.identity.requestOtp(body.phone, body.role ?? UserRole.SHIPPER);
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.identity.verifyOtp(
      body.phone,
      body.code,
      body.role ?? UserRole.SHIPPER,
    );
  }

  @Get('me')
  async me(@Headers('authorization') auth?: string) {
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(
        auth.slice(7),
      );
      return this.identity.me(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
