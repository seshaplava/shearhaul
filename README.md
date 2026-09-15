# ShareHaul

Pan-India freight marketplace — **Dedicated · Shared · Return Load**.

## What's built (pre-deploy)

Full product flows + **real vendor adapters**. **Azure** is the cloud target; App Service deploy is later.

### Surfaces
| App | URL (local) |
|-----|-------------|
| **Web portal** (shipper + driver) | http://localhost:3002 |
| Admin ops | http://localhost:3001 |
| API | http://localhost:3000/v1 |
| Flutter shipper / driver | `flutter run -d chrome` |

| Capability | Default (local demo) | Live mode (set keys + provider) |
|------------|----------------------|----------------------------------|
| OTP SMS | `SMS_PROVIDER=console` (+ `OTP_DEV_CODE`) | `msg91` + MSG91 keys |
| Escrow payments | `PAYMENTS_PROVIDER=mock` | `razorpay` + keys + webhook |
| File storage | `STORAGE_PROVIDER=local` | **`azure`** Blob + connection string |
| Push | `PUSH_PROVIDER=db` (in-app) | `fcm` + Firebase service account |
| Maps distance / static | `MAPS_PROVIDER=haversine` | `google` + API key |
| KYC | `KYC_PROVIDER=manual` (admin review) | `hyperverge` + app id/key |
| Docs | Real PDF (pdfkit) → storage | Same |

Copy `services/api/.env.example` → `.env` and flip providers when you have credentials.  
Azure notes: `docs/AZURE.md` · keys: `docs/GO_LIVE_KEYS.md`

### Core marketplace
- OTP auth (shipper / driver / admin)
- Post loads: Dedicated, Shared, Return (multi-corridor)
- Matching + Shared weight×distance split + multi-stop routing
- Trip lifecycle, per-stop POD, GPS tracking
- Escrow HOLD → capture → ledger → payout (mock or Razorpay)

### Trust & ops
- KYC upload + vendor/manual review
- Claims, ratings, insurance quote SKU
- LR / GST invoice **PDF generation**
- FCM-ready push + device token register
- Admin console, i18n (en/hi/ta/te/kn/mr)

## Run locally

```bash
cd services/api && npm run start:dev
cd apps/admin_web && npm run dev          # :3001
cd apps/web && npm run dev                # :3002 public web UI
cd apps/shipper_app && flutter run -d chrome
cd apps/driver_app && flutter run -d chrome
```

### Docker (full stack)
Requires Docker Desktop. Builds API + Admin + Web with Postgres + Redis:

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3002 |
| Admin | http://localhost:3001 |
| API | http://localhost:3000/v1 |
| Postgres | localhost:5432 (`sharehaul` / `sharehaul`) |
| Redis | localhost:6379 |

Browser calls API at `http://localhost:3000/v1` (set at image build time).

Dev OTP: `123456`  
Drivers: `9000000001`–`9000000003`  
API: http://localhost:3000/v1  
Web: http://localhost:3002  
Admin: http://localhost:3001  
Integrations status: http://localhost:3000/v1/integrations/status

### Razorpay webhook (local)
Point Razorpay dashboard to your tunnel URL:  
`POST /v1/payments/webhooks/razorpay`

### Still later (by design)
- Deploy to **Azure** (App Service / Container Apps + Postgres + Redis)
- App Store / Play Store release
- Government e-way bill live API
-Hi