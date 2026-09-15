# Go-live keys (Azure-first — before App Service / AKS deploy)

Do this on your machine; full Azure deploy can wait.

## 1. Razorpay (sandbox first)
1. Create account → get Test Key ID + Secret  
2. In `.env`:
   ```
   PAYMENTS_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   ```
3. Webhook events: `payment.authorized`, `payment.captured` → `POST /v1/payments/webhooks/razorpay`  
4. Apps: after select offer, open checkout / call `POST /v1/payments/confirm`

## 2. MSG91 SMS
```
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_TEMPLATE_ID=...   # optional flow template with OTP variable
MSG91_SENDER=SHRHAUL
```
Remove or blank `OTP_DEV_CODE` in production.

## 3. Azure Blob Storage (primary — KYC / POD / PDFs)
1. Azure Portal → **Storage account** → Containers → create `sharehaul-docs` (private)
2. Access keys → copy connection string **or** account name + key
3. In `.env`:
```
STORAGE_PROVIDER=azure
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER=sharehaul-docs
```
Or:
```
STORAGE_PROVIDER=azure
AZURE_STORAGE_ACCOUNT=youraccount
AZURE_STORAGE_ACCOUNT_KEY=...
AZURE_STORAGE_CONTAINER=sharehaul-docs
```

## 4. Firebase Cloud Messaging
```
PUSH_PROVIDER=fcm
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
Apps register via `POST /v1/devices/token`.

## 5. Google Maps
```
MAPS_PROVIDER=google
GOOGLE_MAPS_API_KEY=...          # server Distance Matrix
GOOGLE_MAPS_BROWSER_KEY=...      # optional Static Maps / JS
```

## 6. HyperVerge (or keep manual)
```
KYC_PROVIDER=hyperverge
HYPERVERGE_APP_ID=...
HYPERVERGE_APP_KEY=...
```

## Check
`GET /v1/integrations/status` shows active providers.

## Later: Azure deploy (not done yet)
- Azure Database for PostgreSQL
- Azure Cache for Redis
- App Service or Container Apps for Nest API
- Static Web Apps / App Service for admin
- Key Vault for secrets
