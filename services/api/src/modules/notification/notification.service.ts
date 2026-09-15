import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { INTEGRATION_TOKENS, type PushProvider } from '../../integrations/ports';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRATION_TOKENS.PUSH) private readonly pushProvider: PushProvider,
  ) {}

  async push(
    userId: string,
    title: string,
    body: string,
    meta?: Prisma.InputJsonValue,
    channel = 'IN_APP',
  ) {
    const row = await this.prisma.appNotification.create({
      data: { userId, title, body, meta, channel },
    });
    await this.prisma.outboxEvent.create({
      data: {
        type: 'notification.created',
        payload: { notificationId: row.id, userId, title, channel },
      },
    });

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (devices.length) {
      const data: Record<string, string> = {};
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
          data[k] = String(v);
        }
      }
      await this.pushProvider.send({
        tokens: devices.map((d) => d.token),
        title,
        body,
        data,
      });
    }
    return row;
  }

  list(userId: string) {
    return this.prisma.appNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, id: string) {
    return this.prisma.appNotification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }
}
