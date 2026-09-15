import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  INTEGRATION_TOKENS,
  type PdfProvider,
  type StorageProvider,
} from '../../integrations/ports';

class CreateDocDto {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  loadId?: string;

  @IsString()
  docType!: string;

  @IsOptional()
  @IsString()
  storageKey?: string;
}

@Controller('documents')
@UseGuards(JwtAuthGuard)
class DocumentController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRATION_TOKENS.PDF) private readonly pdf: PdfProvider,
    @Inject(INTEGRATION_TOKENS.STORAGE) private readonly storage: StorageProvider,
  ) {}

  @Post()
  create(@Body() dto: CreateDocDto) {
    const key =
      dto.storageKey ??
      `docs/${dto.docType}/${dto.tripId ?? dto.loadId ?? 'x'}-${Date.now()}.pdf`;
    return this.prisma.documentRecord.create({
      data: {
        tripId: dto.tripId,
        loadId: dto.loadId,
        docType: dto.docType,
        storageKey: key,
        meta: { generated: false },
      },
    });
  }

  @Get('trip/:tripId')
  byTrip(@Param('tripId') tripId: string) {
    return this.prisma.documentRecord.findMany({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('trip/:tripId/lr')
  async issueLr(@Param('tripId') tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { stops: { orderBy: { seq: 'asc' } }, vehicle: true },
    });
    const from = trip?.stops.find((s) => s.type === 'PICKUP')?.address ?? 'Origin';
    const to =
      trip?.stops.filter((s) => s.type === 'DROPOFF').pop()?.address ?? 'Dest';
    const buf = await this.pdf.generateLr({
      tripId,
      from,
      to,
      vehicleReg: trip?.vehicle?.regNo,
    });
    const key = `docs/lr/${tripId}.pdf`;
    await this.storage.putObject(key, buf, 'application/pdf');
    const url = await this.storage.createDownloadUrl(key);
    return this.prisma.documentRecord.create({
      data: {
        tripId,
        docType: 'LR',
        storageKey: key,
        meta: { gstHook: true, ewayHook: true, url, bytes: buf.length },
      },
    });
  }

  @Post('trip/:tripId/invoice')
  async invoice(@Param('tripId') tripId: string) {
    const payment = await this.prisma.paymentIntent.findFirst({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
    });
    const buf = await this.pdf.generateInvoice({
      tripId,
      amountPaisa: payment?.amountPaisa ?? 0,
    });
    const key = `docs/invoice/${tripId}.pdf`;
    await this.storage.putObject(key, buf, 'application/pdf');
    const url = await this.storage.createDownloadUrl(key);
    return this.prisma.documentRecord.create({
      data: {
        tripId,
        docType: 'GST_INVOICE',
        storageKey: key,
        meta: { currency: 'INR', url, bytes: buf.length },
      },
    });
  }
}

@Module({
  imports: [IdentityModule],
  controllers: [DocumentController],
})
export class DocumentModule {}
