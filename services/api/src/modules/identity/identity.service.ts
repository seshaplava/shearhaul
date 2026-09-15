import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { INTEGRATION_TOKENS, type SmsProvider } from '../../integrations/ports';

@Injectable()
export class IdentityService {
  private readonly log = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(INTEGRATION_TOKENS.SMS) private readonly sms: SmsProvider,
  ) {}

  async requestOtp(phone: string, role: UserRole = UserRole.SHIPPER) {
    this.assertPhone(phone);
    const code =
      this.sms.name === 'console' && this.config.get<string>('OTP_DEV_CODE')
        ? this.config.get<string>('OTP_DEV_CODE')!
        : String(randomInt(100000, 999999));

    const ttlSec = Number(this.config.get('OTP_TTL_SEC') ?? 300);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    await this.prisma.otpChallenge.create({
      data: {
        phone,
        codeHash: this.hash(code),
        expiresAt,
      },
    });

    try {
      await this.sms.sendOtp(phone, code);
    } catch (e) {
      this.log.error(`SMS failed: ${e}`);
      if (this.sms.name === 'msg91' && this.config.get('NODE_ENV') === 'production') {
        throw new BadRequestException('Failed to send OTP SMS');
      }
    }

    const exposeCode =
      this.config.get('NODE_ENV') !== 'production' || this.sms.name === 'console';
    return {
      ok: true,
      phone,
      role,
      expiresInSec: ttlSec,
      smsProvider: this.sms.name,
      ...(exposeCode ? { devCode: code } : {}),
    };
  }

  async verifyOtp(phone: string, code: string, role: UserRole = UserRole.SHIPPER) {
    this.assertPhone(phone);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumed: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      throw new UnauthorizedException('OTP expired or missing');
    }
    if (challenge.attempts >= 5) {
      throw new UnauthorizedException('Too many attempts');
    }

    const ok = challenge.codeHash === this.hash(code);
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: { increment: 1 },
        consumed: ok,
      },
    });
    if (!ok) {
      throw new UnauthorizedException('Invalid OTP');
    }

    let user = await this.prisma.user.findUnique({
      where: { phone },
      include: { roles: true },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          roles: { create: { role } },
          ...(role === UserRole.SHIPPER
            ? { shipperProfile: { create: {} } }
            : {}),
          ...(role === UserRole.DRIVER
            ? { driverProfile: { create: {} } }
            : {}),
          ...(role === UserRole.FLEET_OWNER
            ? { fleetProfile: { create: {} } }
            : {}),
        },
        include: { roles: true },
      });
    } else if (!user.roles.some((r) => r.role === role)) {
      await this.prisma.userRoleAssignment.create({
        data: { userId: user.id, role },
      });
      user = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { roles: true },
      });
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        phone: user.phone,
        locale: user.locale,
        roles: user.roles.map((r) => r.role),
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      locale: user.locale,
      roles: user.roles.map((r) => r.role),
    };
  }

  private assertPhone(phone: string) {
    if (!/^\+?[0-9]{10,15}$/.test(phone)) {
      throw new BadRequestException('Invalid phone');
    }
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
