import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { KycStatus, UserRole } from '@prisma/client';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationModule } from '../notification/notification.module';
import { INTEGRATION_TOKENS, type KycProvider } from '../../integrations/ports';

class SubmitKycDto {
  @IsString()
  docType!: string;

  @IsString()
  storageKey!: string;
}

class ReviewKycDto {
  @IsEnum(KycStatus)
  status!: KycStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('kyc')
@UseGuards(JwtAuthGuard)
class KycController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    @Inject(INTEGRATION_TOKENS.KYC) private readonly kycVendor: KycProvider,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: user.userId },
    });
    const docs = await this.prisma.kycDocument.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      driverKyc: driver?.kycStatus ?? 'NOT_STARTED',
      vendor: this.kycVendor.name,
      documents: docs,
    };
  }

  @Post('documents')
  async submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitKycDto) {
    const vendor = await this.kycVendor.verifyDocument({
      docType: dto.docType,
      storageKey: dto.storageKey,
      userId: user.userId,
    });

    const status =
      vendor.status === 'VERIFIED'
        ? KycStatus.VERIFIED
        : vendor.status === 'REJECTED'
          ? KycStatus.REJECTED
          : KycStatus.IN_REVIEW;

    const doc = await this.prisma.kycDocument.create({
      data: {
        userId: user.userId,
        docType: dto.docType,
        storageKey: dto.storageKey,
        status,
        notes: vendor.notes,
      },
    });

    await this.prisma.driverProfile.updateMany({
      where: { userId: user.userId },
      data: { kycStatus: status },
    });

    if (status === KycStatus.VERIFIED || status === KycStatus.REJECTED) {
      await this.notify.push(
        user.userId,
        'KYC updated',
        `Your document ${dto.docType} is ${status}`,
      );
    }

    return { document: doc, vendor };
  }

  @Post('documents/:id/review')
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
  ) {
    if (!user.roles.includes(UserRole.ADMIN)) {
      throw new BadRequestException('Admin only');
    }
    const doc = await this.prisma.kycDocument.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes },
    });
    if (dto.status === KycStatus.VERIFIED || dto.status === KycStatus.REJECTED) {
      await this.prisma.driverProfile.updateMany({
        where: { userId: doc.userId },
        data: { kycStatus: dto.status },
      });
      await this.notify.push(
        doc.userId,
        'KYC updated',
        `Your document ${doc.docType} is ${dto.status}`,
      );
    }
    return doc;
  }
}

@Module({
  imports: [IdentityModule, NotificationModule],
  controllers: [KycController],
})
export class KycModule {}
