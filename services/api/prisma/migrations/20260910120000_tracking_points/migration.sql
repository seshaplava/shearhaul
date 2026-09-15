-- CreateTable
CREATE TABLE "tracking_points" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracking_points_trip_id_recorded_at_idx" ON "tracking_points"("trip_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "tracking_points" ADD CONSTRAINT "tracking_points_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
