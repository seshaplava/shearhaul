import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/jwt-auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  INTEGRATION_TOKENS,
  type MapsProvider,
  type StorageProvider,
} from './ports';
import { LocalStorageProvider } from './storage/storage.providers';

class PresignDto {
  @IsString()
  key!: string;

  @IsString()
  contentType!: string;
}

class DeviceTokenDto {
  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  platform?: string;
}

@Controller()
export class IntegrationsController {
  constructor(
    @Inject(INTEGRATION_TOKENS.STORAGE) private readonly storage: StorageProvider,
    @Inject(INTEGRATION_TOKENS.MAPS) private readonly maps: MapsProvider,
    private readonly local: LocalStorageProvider,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('integrations/status')
  status() {
    return {
      sms: this.config.get('SMS_PROVIDER') ?? 'console',
      storage: this.config.get('STORAGE_PROVIDER') ?? 'local',
      payments: this.config.get('PAYMENTS_PROVIDER') ?? 'mock',
      push: this.config.get('PUSH_PROVIDER') ?? 'db',
      maps: this.config.get('MAPS_PROVIDER') ?? 'haversine',
      kyc: this.config.get('KYC_PROVIDER') ?? 'manual',
      googleMapsBrowserKey: this.config.get('GOOGLE_MAPS_BROWSER_KEY') ?? null,
      razorpayKeyId:
        (this.config.get('PAYMENTS_PROVIDER') ?? 'mock') === 'razorpay'
          ? this.config.get('RAZORPAY_KEY_ID')
          : null,
    };
  }

  @Post('storage/presign')
  @UseGuards(JwtAuthGuard)
  async presign(@Body() dto: PresignDto) {
    return this.storage.createUploadUrl({
      key: dto.key,
      contentType: dto.contentType,
    });
  }

  @Post('storage/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(
    @Query('key') key: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    if (!key) throw new BadRequestException('key required');
    if (!file?.buffer) throw new BadRequestException('file required');
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const url = await this.storage.createDownloadUrl(key);
    return { key, url };
  }

  @Get('storage/download')
  async download(@Query('key') key: string, @Res() res: Response) {
    if (!key) {
      res.status(400).send('key required');
      return;
    }
    if (this.storage.name === 'local') {
      const full = this.local.resolvePath(key);
      if (!existsSync(full)) {
        res.status(404).send('Not found');
        return;
      }
      if (key.endsWith('.pdf')) res.type('application/pdf');
      createReadStream(full).pipe(res);
      return;
    }
    const url = await this.storage.createDownloadUrl(key, 300);
    res.redirect(url);
  }

  @Post('devices/token')
  @UseGuards(JwtAuthGuard)
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeviceTokenDto,
  ) {
    return this.prisma.deviceToken.upsert({
      where: {
        userId_token: { userId: user.userId, token: dto.token },
      },
      create: {
        userId: user.userId,
        token: dto.token,
        platform: dto.platform ?? 'web',
      },
      update: { platform: dto.platform ?? 'web' },
    });
  }

  @Get('maps/static')
  @UseGuards(JwtAuthGuard)
  staticMap(@Query('lat') lat: string, @Query('lng') lng: string) {
    const url = this.maps.staticMapUrl?.({
      lat: Number(lat),
      lng: Number(lng),
    });
    return { url, provider: this.maps.name };
  }
}
