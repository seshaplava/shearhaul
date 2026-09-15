# Azure target (ShareHaul)

Cloud choice for this project: **Microsoft Azure** (not AWS).

## Now (code ready)
| Service | Azure product | Env |
|---------|---------------|-----|
| Object storage | **Blob Storage** | `STORAGE_PROVIDER=azure` + connection string / account+key |
| Secrets (later) | Key Vault | map into App Settings |
| DB (later deploy) | Azure Database for PostgreSQL | `DATABASE_URL` |
| Cache (later) | Azure Cache for Redis | `REDIS_URL` |
| API host (later) | App Service or Container Apps | image from `services/api/Dockerfile` |
| Admin / Web (later) | App Service / Container Apps | images from `apps/*/Dockerfile` |

## Local today
- Infra only: `docker compose up postgres redis`
- Full stack: `docker compose up --build` (Postgres, Redis, API `:3000`, Admin `:3001`, Web `:3002`)
- Or run apps with npm as in root `README.md`

Keep `STORAGE_PROVIDER=local` until you create a storage account, then switch to `azure`.

See `docs/GO_LIVE_KEYS.md` for the exact `.env` block.
