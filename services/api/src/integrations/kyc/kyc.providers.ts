import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KycProvider } from '../ports';

@Injectable()
export class ManualKycProvider implements KycProvider {
  readonly name = 'manual';

  async verifyDocument() {
    return {
      status: 'IN_REVIEW' as const,
      notes: 'Queued for admin review',
    };
  }
}

/** HyperVerge / IDfy-style webhook-ready adapter. Calls vendor when keys present. */
@Injectable()
export class HypervergeKycProvider implements KycProvider {
  readonly name = 'hyperverge';
  private readonly log = new Logger(HypervergeKycProvider.name);

  constructor(private readonly config: ConfigService) {}

  async verifyDocument(params: {
    docType: string;
    storageKey: string;
    userId: string;
  }) {
    const appId = this.config.get('HYPERVERGE_APP_ID');
    const appKey = this.config.get('HYPERVERGE_APP_KEY');
    const base =
      this.config.get('HYPERVERGE_BASE_URL') ??
      'https://ind.idv.hyperverge.co/v1';

    if (!appId || !appKey) {
      this.log.warn('HyperVerge keys missing — falling back to IN_REVIEW');
      return {
        status: 'IN_REVIEW' as const,
        notes: 'Vendor keys not configured',
      };
    }

    try {
      const res = await fetch(`${base}/verify/document`, {
        method: 'POST',
        headers: {
          appId,
          appKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionId: `${params.userId}-${Date.now()}`,
          documentType: params.docType,
          documentUrl: params.storageKey,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        this.log.error(`KYC vendor error: ${res.status} ${text}`);
        return {
          status: 'IN_REVIEW' as const,
          notes: `Vendor HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as {
        result?: string;
        score?: number;
        referenceId?: string;
      };
      const ok =
        data.result === 'PASS' ||
        data.result === 'pass' ||
        data.result === 'VERIFIED';
      return {
        status: ok ? ('VERIFIED' as const) : ('IN_REVIEW' as const),
        score: data.score,
        vendorRef: data.referenceId,
        notes: JSON.stringify(data).slice(0, 500),
      };
    } catch (e) {
      this.log.error(`KYC call failed: ${e}`);
      return {
        status: 'IN_REVIEW' as const,
        notes: 'Vendor unreachable — manual review',
      };
    }
  }
}
