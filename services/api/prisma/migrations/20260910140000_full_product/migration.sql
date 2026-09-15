DO $$ BEGIN
  ALTER TYPE "LoadMode" ADD VALUE 'RETURN';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ratings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ratings_trip_id_from_user_id_to_user_id_key" ON "ratings"("trip_id", "from_user_id", "to_user_id");

CREATE TABLE IF NOT EXISTS "kyc_documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "kyc_documents_user_id_idx" ON "kyc_documents"("user_id");

CREATE TABLE IF NOT EXISTS "insurance_quotes" (
    "id" UUID NOT NULL,
    "load_id" UUID NOT NULL,
    "trip_id" UUID,
    "sku" TEXT NOT NULL DEFAULT 'BASIC_CARGO',
    "premium_paisa" INTEGER NOT NULL,
    "cover_paisa" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insurance_quotes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "insurance_quotes_load_id_idx" ON "insurance_quotes"("load_id");

CREATE TABLE IF NOT EXISTS "app_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "meta" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "app_notifications_user_id_created_at_idx" ON "app_notifications"("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "document_records" (
    "id" UUID NOT NULL,
    "trip_id" UUID,
    "load_id" UUID,
    "doc_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "document_records_trip_id_idx" ON "document_records"("trip_id");
