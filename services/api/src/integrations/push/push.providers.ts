import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PushProvider } from '../ports';

@Injectable()
export class DbOnlyPushProvider implements PushProvider {
  readonly name = 'db';
  private readonly log = new Logger(DbOnlyPushProvider.name);

  async send(params: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }) {
    this.log.log(
      `[push:db] ${params.title} → ${params.tokens.length} tokens (in-app only)`,
    );
    return { successCount: 0 };
  }
}

@Injectable()
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  private readonly log = new Logger(FcmPushProvider.name);
  private messaging: {
    sendEachForMulticast: (msg: unknown) => Promise<{ successCount: number }>;
  } | null = null;

  constructor(private readonly config: ConfigService) {
    void this.init();
  }

  private async init() {
    const projectId = this.config.get('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      this.log.warn('FCM credentials incomplete — push disabled until set');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const admin: any = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      }
      this.messaging = admin.messaging();
      this.log.log('FCM initialized');
    } catch (e) {
      this.log.error(`FCM init failed: ${e}`);
    }
  }

  async send(params: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }) {
    if (!this.messaging || params.tokens.length === 0) {
      return { successCount: 0 };
    }
    const res = await this.messaging.sendEachForMulticast({
      tokens: params.tokens,
      notification: { title: params.title, body: params.body },
      data: params.data,
    });
    return { successCount: res.successCount };
  }
}
