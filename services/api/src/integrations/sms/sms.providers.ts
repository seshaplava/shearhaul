import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmsProvider } from '../ports';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly log = new Logger(ConsoleSmsProvider.name);

  async sendOtp(phone: string, code: string) {
    this.log.log(`[SMS:console] OTP for ${phone}: ${code}`);
    return { sent: true, providerRef: `console_${Date.now()}` };
  }
}

@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  readonly name = 'msg91';
  private readonly log = new Logger(Msg91SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string) {
    const authKey = this.config.get<string>('MSG91_AUTH_KEY');
    const templateId = this.config.get<string>('MSG91_TEMPLATE_ID');
    const sender = this.config.get<string>('MSG91_SENDER') ?? 'SHRHAUL';
    if (!authKey) {
      throw new Error('MSG91_AUTH_KEY missing');
    }

    const mobile = phone.replace(/^\+/, '');
    // Flow API (OTP) — works when template is configured; otherwise falls back to SMS API.
    if (templateId) {
      const url = `https://control.msg91.com/api/v5/flow/`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_id: templateId,
          recipients: [{ mobiles: mobile, OTP: code }],
          sender,
        }),
      });
      const body = await res.text();
      if (!res.ok) {
        this.log.error(`MSG91 flow failed: ${res.status} ${body}`);
        throw new Error(`MSG91 send failed: ${res.status}`);
      }
      return { sent: true, providerRef: body.slice(0, 120) };
    }

    const qs = new URLSearchParams({
      authkey: authKey,
      mobiles: mobile,
      message: `ShareHaul OTP is ${code}. Valid for 5 minutes.`,
      sender,
      route: '4',
    });
    const res = await fetch(`https://control.msg91.com/api/sendhttp.php?${qs}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MSG91 SMS failed: ${text}`);
    }
    return { sent: true, providerRef: text };
  }
}
