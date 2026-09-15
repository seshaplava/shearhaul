# ShareHaul — Deep Production Architecture

Pan-India shared freight marketplace (**Dedicated** / **Shared** / **Return Load**).

This document is the technical source of truth for scaffolding and production design. Product narrative lives in `PITCH.md`.

---

## 1. Problem we solve

India’s intercity road freight wastes capacity and trust. Architecture must address:

| Problem | Architecture response |
|---------|----------------------|
| Empty / half-empty trucks, especially **return trips** | Shared matching + Return Load offers near delivery |
| Shippers overpay for **part capacity** | Dedicated vs Shared modes + transparent price split / savings |
| Drivers/fleets idle waiting for loads | Matching engine, corridor liquidity, fast payout path |
| Broker / WhatsApp coordination — slow, opaque | Apps + APIs: post → match → track → POD → settle |
| **No reliable price discovery** | Catalog rate cards + `MatchOffer` price breakdown |
| **Payment risk** (fraud / delayed settlement) | Escrow HOLD → POD → capture fee + payout; idempotent ledger |
| **Cargo risk / weak accountability** | KYC, geo-fenced POD, ratings, claims |
| **Visibility gap** (“Where is my load?”) | GPS tracking, trip status WSS/push, admin monitor |
| **Document friction** (LR, GST, e-way) | Document module + e-way metadata hooks (automation later) |
| **Language / literacy barrier** | Locale packs, voice input, icon-first flows |
| **Time uncertainty** (not instant Uber) | Explicit load windows; ETA ranges; honest SLAs in UX |

**Result we design for:** lower freight cost, higher truck utilization, less empty running, end-to-end trust (money + cargo + visibility).

---

## 2. Goals, non-goals, principles

### Goals
- Android-first, low-end devices, weak networks
- Corridor-based liquidity with national product shell
- Strong trust: KYC, escrow, tracking, POD, claims
- Multi-language ready (ship top languages; architecture for 22+)
- Scale path to high trip concurrency without rewriting the core domain

### Non-goals (v1)
- Full broker auction marketplace
- Warehouse / WMS SaaS
- Cold-chain IoT
- Credit underwriting / BNPL
- Pan-India microservices split on day one
- Instant Uber-style assign for intercity (windows are hours/days)

### Design principles
1. **One modular monolith first** — NestJS modules = service boundaries; split only when load or team demands
2. **Money and trip state are sacred** — append-only ledger + audited state transitions
3. **Dedicated before Shared** — Shared requires density; gate with feature flags
4. **Honest ETAs** — never fake instant match; expose windows and ranges
5. **Idempotent everything** that touches money, accept, or status
6. **Corridor rollout** — national UI, local liquidity
7. **Backend owns business rules** — Flutter/Next only render and call APIs

---

## 3. Frozen v1 tech decisions

Ambiguity kills production. v1 is locked as:

| Layer | Decision |
|-------|----------|
| Mobile | Flutter (shipper app + driver app) |
| Admin | Next.js + TypeScript |
| API | NestJS modular monolith (`services/api`) |
| DB | PostgreSQL + PostGIS |
| Cache / locks | Redis |
| Queue | AWS SQS + SNS (not Kafka in v1) |
| Search (v1) | Postgres + PostGIS; OpenSearch only if discovery load requires |
| Maps | One provider behind `MapsPort` (Google **or** MapmyIndia — pick at scaffold) |
| Push | FCM (+ APNs) |
| SMS / OTP | MSG91 (Twilio backup later) |
| Payments | Razorpay (UPI + payouts); Cashfree as documented alternate |
| Objects | S3 |
| i18n | JSON locale packs on CDN + Flutter ARB for UI keys |
| Observability | OpenTelemetry → Grafana / Datadog |
| Infra | AWS, ECS Fargate first (K8s later if needed) |
| CI | GitHub Actions: lint → test → build → migrate → deploy |

---

## 4. System context

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Shipper App  │  │ Driver App   │  │ Admin Web    │
│ (Flutter)    │  │ (Flutter)    │  │ (Next.js)    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ HTTPS/WSS       │                 │
       └─────────────────┼─────────────────┘
                         ▼
              ┌────────────────────┐
              │  ALB + API Gateway │  TLS, WAF, rate limit, JWT
              │  (Nginx / AWS ALB) │
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │  ShareHaul API     │  NestJS modular monolith
              │  + Admin BFF       │
              └─────────┬──────────┘
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   PostgreSQL(+PostGIS) Redis        SQS/SNS
         │                              │
         │                         workers:
         │                    notify, payout, match,
         │                    tracking fan-out, outbox
         ▼
   S3 (KYC/POD) · Razorpay · Maps · MSG91 · FCM · KYC vendor
```

**Clients never talk to payment/KYC vendors directly for settle logic** — only hosted checkout / SDK where required; webhooks hit API.

---

## 5. Modular monolith (internal architecture)

Deploy **one** API service. Inside, modules with clear ownership. No cross-module DB writes except via published APIs/events.

```
services/api/
  src/
    modules/
      identity/       # auth, OTP, sessions, roles
      kyc/            # docs, verification status
      catalog/        # vehicle types, corridors, rate cards
      load/           # LoadRequest CRUD + search
      matching/       # dedicated / shared / return offers
      trip/           # state machine, stops, accept
      tracking/       # GPS ingest, geofence, ETA
      payment/        # holds, ledger, payouts, webhooks
      notification/   # push, SMS, WhatsApp templates
      document/       # LR, POD PDF, GST invoice
      claims/         # disputes, insurance handoff
      analytics/      # savings, CO₂, corridor KPIs
      admin-bff/      # ops-shaped read/write APIs
      i18n/           # locale pack URLs / fallbacks
    common/
      auth/           # JWT guards, RBAC
      idempotency/
      outbox/
      locks/          # Redis distributed locks
      maps/           # MapsPort adapter
      feature-flags/
```

### Module dependency rules
- `trip` may call `matching`, `payment`, `tracking`, `notification` via application services
- `payment` never depends on Flutter concepts; only ledger + gateway adapter
- `admin-bff` composes other modules; no direct SQL into payment tables from admin UI
- Shared types live in `packages/shared-types`

### When to split a real microservice later
Split only if: independent scale (e.g. tracking ingest), independent deploy cadence, or blast-radius isolation (payments). Default: stay monolith.

---

## 6. Core domain model (deep)

### Entities

| Entity | Key fields | Notes |
|--------|------------|-------|
| `User` | id, phone, roles[], locale, status | Roles: `SHIPPER`, `DRIVER`, `FLEET_OWNER`, `ADMIN` |
| `ShipperProfile` | business_name, GSTIN, addresses | MSME / enterprise |
| `DriverProfile` | license_no, fleet_owner_id?, rating | KYC-gated for accept |
| `FleetOwnerProfile` | payout_account_ref, drivers[] | Multi-vehicle |
| `Vehicle` | type, capacity_kg, capacity_cft, reg_no, kyc_status | Active only if KYC OK |
| `Corridor` | origin_city, dest_city, polyline_ref, active | Feature-flagged |
| `RateCard` | corridor_id, vehicle_type, base_paisa, per_km, per_kg | Versioned |
| `LoadRequest` | mode, origin, dest, weight, volume, cargo_type, window_start/end, status | `DEDICATED` \| `SHARED` |
| `MatchOffer` | load_id, vehicle_id?, trip_id?, price_breakdown_json, expires_at | Score + quote |
| `Trip` | mode, vehicle_id, status, corridor_id | One vehicle, N stops |
| `TripStop` | trip_id, seq, load_id, type(PICKUP\|DROPOFF), geo, eta, pod_id | Ordered |
| `TrackingPoint` | trip_id, lat, lng, speed, recorded_at, received_at | Partitioned |
| `PaymentIntent` | load_id/trip_id, amount, currency=INR, status | Gateway mapping |
| `LedgerEntry` | account, direction, amount_paisa, ref_type, ref_id, idempotency_key | Append-only |
| `Payout` | beneficiary, amount, status, gateway_ref | Driver/fleet |
| `Pod` | stop_id, photo_s3, otp_ok, geo_ok, signed_at | Required to settle |
| `Claim` | trip_id, type, status, amount_claimed | Blocks or claws payout |
| `Rating` | from_user, to_user, trip_id, stars, tags | Bilateral |
| `SavingsLedger` | trip_id, inr_saved, km_saved, co2_kg_proxy | Shared trips |
| `OutboxEvent` | type, payload, published_at | Reliable messaging |
| `AuditLog` | actor, action, entity, before/after | Admin + money |

### Logical relationships
```
User 1──* Role
User 1──1 ShipperProfile | DriverProfile | FleetOwnerProfile
FleetOwner 1──* Driver / Vehicle
Corridor 1──* RateCard
Shipper 1──* LoadRequest
LoadRequest 1──* MatchOffer
Trip 1──* TripStop 1──0..1 Pod
Trip 1──* TrackingPoint
Trip 1──* PaymentIntent / LedgerEntry / Payout
Trip 0..1──* Claim
LoadRequest / Trip → SavingsLedger (shared)
```

---

## 7. State machines

### 7.1 LoadRequest
`DRAFT → OPEN → MATCHING → BOOKED → IN_TRIP → COMPLETED`  
(+ `CANCELLED`, `EXPIRED`)

### 7.2 Trip
```
DRAFT
  → MATCHING
  → ASSIGNED
  → EN_ROUTE_PICKUP
  → AT_PICKUP
  → LOADED
  → IN_TRANSIT
  → AT_DROPOFF
  → DELIVERED          # all stop PODs done
  → SETTLING
  → SETTLED

CANCELLED (from MATCHING|ASSIGNED|EN_ROUTE_PICKUP with rules)
DISPUTED  (from LOADED..DELIVERED; freezes payout)
```

**Transition rules (enforced in `trip` module):**
- Only allowed edges; every change writes `trip_events` + outbox
- `ASSIGNED` requires: vehicle KYC OK + Redis lock + payment HOLD success (Dedicated) or policy for Shared
- `DELIVERED` requires all dropoff PODs `PASSED`
- `SETTLED` requires ledger capture + payout initiated (or scheduled)
- `DISPUTED` stops auto-payout

### 7.3 Payment
```
CREATED → HOLD_PENDING → HELD → CAPTURE_PENDING → CAPTURED
                      ↘ FAILED
HELD → REFUND_PENDING → REFUNDED
HELD → PARTIAL_CAPTURE (optional policy)
CAPTURED → PAYOUT_PENDING → PAID
Any → DISPUTE_HOLD
```

### 7.4 KYC
`NOT_STARTED → SUBMITTED → IN_REVIEW → VERIFIED | REJECTED | EXPIRED`

### 7.5 Claim
`OPEN → UNDER_REVIEW → APPROVED | REJECTED | SETTLED`

---

## 8. End-to-end flows

### 8.1 Dedicated happy path
```
Shipper                  API                     Driver              Razorpay
   |                      |                        |                    |
   | POST /loads          |                        |                    |
   | (DEDICATED)          |→ matching job          |                    |
   |← offers              |                        |                    |
   | POST /payments/hold  |───────────────────────►| create payment     |
   |← checkout            |                        |                    |
   | pay UPI              |◄── webhook HELD ───────|                    |
   |                      |→ create Trip ASSIGNED  |                    |
   |                      |→ notify nearby/assigned|                    |
   |                      |                        | accept/confirm     |
   |                      |← status EN_ROUTE...    | GPS batches        |
   | track                |← tracking              |                    |
   |                      |← POD                   |                    |
   |                      |→ CAPTURE + PAYOUT      |───────────────────►|
   | rate + savings       |                        |← paid              |
```

### 8.2 Shared path (Phase 2+)
1. Multiple `LoadRequest` OPEN on same corridor + overlapping windows + compatible cargo
2. Matcher bins into vehicle capacity (kg + cft)
3. Builds stop sequence; quotes each shipper with split price + ETA range + co-load count
4. Each shipper HOLDs their share; trip ASSIGNED only when capacity threshold / timeout policy met
5. Multi-stop PODs; settle when all delivered (or per-stop policy later)

### 8.3 Return load
- Trigger: trip nearing last dropoff (geofence or ETA < T) **and** free capacity
- Open reverse-corridor `MatchOffer` to nearby loads
- Driver opt-in; new stop(s) appended under rules; price additive

---

## 9. Matching engine (deep)

### Inputs
- Load: geo, window, weight, volume, cargo_type, mode, vehicle prefs
- Supply: available vehicles/drivers with location, capacity remaining, KYC, rating, corridor affinity
- Catalog: rate cards, cargo compatibility matrix, feature flags

### Dedicated algorithm (v1)
1. **Filter:** vehicle_type, capacity ≥ load, KYC=VERIFIED, not on conflicting trip, within pickup radius R, corridor enabled
2. **Score:**  
   `w1*dist_pickup + w2*(1/rating) + w3*price + w4*eta` (weights tunable)
3. **Output:** top N `MatchOffer` with expiry (e.g. 5–15 min)
4. **Assign:** shipper selects **or** auto-assign (enterprise flag)
5. **Lock:** `Redis SET match:lock:{vehicleId}` with TTL during accept/pay

### Shared algorithm (Phase 2)
1. **Bucket key:** `corridor_id + time_bucket + cargo_ Compatibility_class`
2. **Compatibility:** matrix forbids e.g. hazardous + food; max wait deviation
3. **Bin-pack:** first-fit decreasing on weight & volume into vehicle remaining capacity
4. **Routing:** nearest-neighbor seed → 2-opt; respect pickup-before-dropoff per load
5. **Pricing:**  
   - `dedicated_base = RateCard(corridor, vehicle)`  
   - `shared_pool = dedicated_base * shared_discount`  
   - shipper_i pays `shared_pool * (w_i * d_i) / Σ(w*d)` (+ stop fees optional)
6. **UX fields:** price, ETA min/max, co-load count, ₹ saved vs dedicated

### Failure / empty market behavior
- If no offers: keep `MATCHING`, widen radius/time, suggest Dedicated, notify when supply appears
- Never invent fake trucks

### Implementation note
Start rule-based + PostGIS (`ST_DWithin`). ML ranking only after labeled completion data exists.

---

## 10. Trust, payments & ledger (deep)

### Escrow policy (v1)
```
Shipper pays → HOLD (gateway)
All required PODs PASS → CAPTURE platform fee + RELEASE payout
Cancel before assign → full refund
Cancel after assign → cancellation fee policy (config)
DISPUTE opened → DISPUTE_HOLD until claim resolved
```

### Ledger (mandatory)
Every money movement inserts `LedgerEntry` with unique `idempotency_key`:
- `SHIPPER_HOLD`, `SHIPPER_CAPTURE`, `SHIPPER_REFUND`
- `PLATFORM_FEE`
- `DRIVER_PAYOUT` / `FLEET_PAYOUT`
- `CLAIM_ADJUSTMENT`

**Balances are derived from ledger**, not updated in place.

### Webhooks
- Verify signature; persist raw payload; process idempotently by `gateway_event_id`
- Out-of-order events: reconcile against PaymentIntent state machine
- Staging must use gateway test mode before prod

### Payouts
- Default: T+0/T+1 to fleet/driver virtual account
- Instant payout = optional fee (business model)
- Retry with exponential backoff; alert on terminal failure

### KYC gate
- Driver cannot `accept` / trip cannot `ASSIGNED` unless driver + vehicle `VERIFIED`
- Docs in S3 via short-lived signed URLs; never public buckets

### POD
- Geo-fence check (stop radius) + photo + OTP or signature
- Adaptive rules if GPS weak (admin override audited)

### Claims
- Types: DAMAGE, THEFT, DELAY, SHORTAGE
- Opens `DISPUTED` on trip; freezes payout; admin SLA clock starts

---

## 11. Tracking & realtime

### GPS ingest
- Driver app batches points (`POST /v1/tracking/points`) every N seconds
- Adaptive N: good network 5–15s; weak 30–60s; offline queue on device
- Server caps: max points/sec/trip; drop duplicates; store in monthly partitions
- Retention policy (e.g. 90–180 days raw; aggregates longer)

### Realtime to shipper/admin
- Trip status + last location via **WSS** channel `trip:{id}` (authz checked)
- Push notifications on major transitions (assigned, arriving, delivered, payout)

### Geofence
- On enter pickup/dropoff radius → suggest status transition / OTP screen
- Server validates claims of arrival (anti-fraud)

---

## 12. API surface (v1 contract sketch)

All: `/v1`, JWT, rate limits, `Idempotency-Key` on mutating money/status routes.

### Identity
- `POST /v1/auth/otp/request`
- `POST /v1/auth/otp/verify` → tokens
- `POST /v1/auth/refresh`
- `GET  /v1/me`

### KYC / vehicles
- `POST /v1/kyc/documents`
- `GET  /v1/kyc/status`
- `POST /v1/vehicles`
- `GET  /v1/vehicles`

### Loads & matching
- `POST /v1/loads`
- `GET  /v1/loads/:id`
- `POST /v1/loads/:id/cancel`
- `GET  /v1/loads/:id/offers`
- `POST /v1/offers/:id/select`

### Trips
- `POST /v1/trips/:id/accept`
- `POST /v1/trips/:id/status`
- `GET  /v1/trips/:id`
- `GET  /v1/trips/:id/stops`
- `POST /v1/trips/:id/pod`

### Tracking
- `POST /v1/tracking/points`
- `GET  /v1/trips/:id/location`

### Payments / claims / savings
- `POST /v1/payments/hold`
- `POST /v1/payments/webhooks/razorpay` (signature verified)
- `POST /v1/claims`
- `GET  /v1/claims/:id`
- `GET  /v1/savings/:tripId`

### i18n
- `GET /v1/i18n/:locale` → CDN URL + version

### Admin BFF (`/v1/admin/...`)
- Verify KYC, force status (audited), disputes queue, corridor flags, liquidity KPIs

---

## 13. Events (outbox → SQS/SNS)

| Event | Consumers |
|-------|-----------|
| `load.opened` | matching |
| `offer.created` | notify shipper |
| `trip.assigned` | notify driver/shipper, tracking session |
| `trip.status_changed` | notify, analytics |
| `pod.passed` | payment settle check |
| `payment.held` | trip assign continuation |
| `payment.captured` | document invoice |
| `payout.paid` | notify driver |
| `claim.opened` | freeze payout, admin |
| `kyc.verified` | unlock accept |

**Outbox pattern:** write business row + `outbox_events` in same DB transaction; publisher worker pushes to SQS; at-least-once delivery; consumers idempotent.

---

## 14. Data platform & schema patterns

### PostgreSQL
- OLTP source of truth
- PostGIS for vehicle/load proximity
- Partition `tracking_points`, `trip_events` by month
- Soft-delete where legally needed; prefer status flags for money entities

### Redis
- Session / refresh denylist
- Match locks `match:lock:{vehicleId}`
- Rate limits (OTP, GPS, accept)
- Hot trip location cache

### S3
- KYC, POD photos, generated PDFs
- SSE-S3/KMS; pre-signed upload/download

### Search
- v1: SQL + PostGIS indexes on corridor, status, geo
- Later: OpenSearch for fuzzy city/cargo discovery if needed

### Suggested core tables (abbrev)
`users`, `user_roles`, `shipper_profiles`, `driver_profiles`, `fleet_owner_profiles`,  
`vehicles`, `corridors`, `rate_cards`, `cargo_compat`,  
`load_requests`, `match_offers`, `trips`, `trip_stops`, `trip_events`,  
`tracking_points`, `pods`,  
`payment_intents`, `ledger_entries`, `payouts`, `gateway_webhook_events`,  
`claims`, `ratings`, `savings_ledger`,  
`outbox_events`, `audit_logs`, `feature_flags`

---

## 15. Security & compliance

- TLS everywhere; WAF at edge
- PII encrypted at rest; minimize logged PII
- RBAC on every route; trip access scoped to parties + admin
- Admin actions → `audit_logs`
- PCI: no card data on our servers; gateway hosted fields / UPI intents
- Signed webhooks only
- Location consent recorded; retention enforced
- GST fields on invoices; e-way bill metadata hooks (v1), integration later
- Secrets in AWS SM / SSM; never in git

---

## 16. Multi-language & accessibility

- CDN locale JSON versioned (`en`, `hi`, `ta`, …); app fetches by `Accept-Language` / user pref
- Flutter UI keys via ARB; long copy (T&Cs, tips) from CDN to avoid store release
- Voice input for load post where STT available
- Icon-first primary actions for low literacy
- Font: Noto Sans family covering Indian scripts
- Ship order: EN, HI, TA, TE, KN, ML, MR, GU, BN, PA → remaining scheduled languages

---

## 17. Feature flags & corridor rollout

Flags (examples):
- `corridor:{id}:enabled`
- `mode.shared.enabled` (global + per corridor)
- `mode.return.enabled`
- `payments.escrow.enabled`
- `insurance.sku.enabled`

**Launch rule:** Shared OFF until corridor hits minimum loads/trucks/hour threshold (ops-defined).

---

## 18. Infrastructure & environments

```
dev → staging → prod
```

| Concern | Target |
|---------|--------|
| Compute | ECS Fargate (API + workers) |
| DB | RDS Postgres Multi-AZ |
| Redis | ElastiCache |
| Queue | SQS + SNS |
| Edge | ALB + CloudFront (CDN locales) |
| RPO / RTO | Define before public launch (e.g. RPO ≤ 5m PITR, RTO ≤ 1h) |
| Backups | RDS continuous + S3 versioning |
| Migrations | Expand/contract friendly; run in CI before traffic shift |

### CI/CD
Lint → unit → integration → build image → migrate staging → smoke → prod canary → full

### Workers (same codebase, different entry)
- `outbox-publisher`
- `matching-worker`
- `notification-worker`
- `payout-worker`
- `webhook-retry-worker`

---

## 19. Observability & SLOs

- Traces: OpenTelemetry on API + workers
- Metrics: accept latency, match time, hold success %, webhook fail %, GPS ingest lag, payout latency
- Logs: structured JSON; correlate `request_id`, `trip_id`, `payment_id`
- Alerts: payment webhook errors, payout failures, trip stuck in state, DB saturation

**Example SLOs (tune later):**
- Payment webhook processing success ≥ 99.9%
- Time-to-first-offer (dedicated, dense corridor) p50 < X minutes (not seconds)
- POD upload success ≥ 99%

---

## 20. Failure modes & safeguards

| Failure | Safeguard |
|---------|-----------|
| Double accept same vehicle | Redis lock + DB unique active assignment |
| Double charge / double payout | Idempotency keys + ledger uniqueness |
| Webhook delayed/duplicate | Persist + stateful reconcile |
| GPS offline | Device queue; status still manual with geo checks when possible |
| Shared bucket never fills | Timeout → offer Dedicated / cancel HOLD / partial trip policy |
| Gateway down | Fail closed on new HOLDs; don’t assign unpaid |
| Partition / region blip | Multi-AZ RDS; queue retries; status page for ops |
| Dispute after payout | Claim + recovery workflow; prefer freeze before payout |

---

## 21. KPI dashboard (admin)

- Corridor liquidity (loads & trucks per hour)
- Time-to-match
- Fill rate (shared capacity %)
- Empty-mile % reduced
- Trip completion %
- Dispute rate / claim SLA
- Driver payout latency
- Hold → capture conversion
- Language usage mix

---

## 22. Build phases

### Phase 0 — Foundation
Monorepo, NestJS modules skeleton, Postgres schema, auth OTP, admin shell, i18n framework, CI, feature flags

### Phase 1 — Core marketplace (production spine)
Load post, **Dedicated** match, trip lifecycle, tracking, POD, UPI HOLD/CAPTURE, basic KYC gate, ratings

### Phase 2 — Shared mode
Consolidation, multi-stop, price split, savings score; enable per corridor only

### Phase 3 — Trust & scale
Return loads, insurance SKU, claims polish, more languages, OpenSearch if needed, corridor expansion, optional service split

---

## 23. Repo layout (target)

```
ShareHaul/
  apps/
    shipper_app/           # Flutter
    driver_app/            # Flutter
    admin_web/             # Next.js
  services/
    api/                   # NestJS monolith (HTTP + workers)
  packages/
    shared-types/
    i18n/
  docs/
    PITCH.md
    ARCHITECTURE.md
  infra/
    terraform/             # or CDK
```

---

## 24. Good-to-scaffold checklist

Before writing feature code, lock:

- [ ] Maps vendor chosen (`MapsPort` adapter ready)
- [ ] Razorpay account + webhook secret strategy
- [ ] Corridor #1 cities + rate card v0
- [ ] Trip + payment state machines in code as single modules
- [ ] Ledger table + idempotency middleware
- [ ] Feature flag: Shared default OFF
- [ ] RPO/RTO + backup plan written for prod

**Architecture status:** deep design ready to scaffold. Not a claim that the market problem is solved — only that the system shape can support Dedicated-first production on one corridor.
