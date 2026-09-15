export type GeoLoad = {
  id: string;
  weightKg: number;
  volumeCft: number;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  originAddress: string;
  destAddress: string;
};

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest-neighbor order for points starting near (startLat, startLng). */
export function nearestNeighborOrder<T extends { lat: number; lng: number }>(
  points: T[],
  startLat: number,
  startLng: number,
): T[] {
  const left = [...points];
  const ordered: T[] = [];
  let lat = startLat;
  let lng = startLng;
  while (left.length) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < left.length; i++) {
      const d = haversineKm(lat, lng, left[i].lat, left[i].lng);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = left.splice(best, 1)[0];
    ordered.push(next);
    lat = next.lat;
    lng = next.lng;
  }
  return ordered;
}

export function buildSharedStopPlan(loads: GeoLoad[]) {
  let pickups = nearestNeighborOrder(
    loads.map((l) => ({
      loadId: l.id,
      type: 'PICKUP' as const,
      address: l.originAddress,
      lat: l.originLat,
      lng: l.originLng,
    })),
    loads[0]?.originLat ?? 0,
    loads[0]?.originLng ?? 0,
  );
  pickups = twoOpt(pickups);
  const last = pickups[pickups.length - 1];
  let dropoffs = nearestNeighborOrder(
    loads.map((l) => ({
      loadId: l.id,
      type: 'DROPOFF' as const,
      address: l.destAddress,
      lat: l.destLat,
      lng: l.destLng,
    })),
    last?.lat ?? 0,
    last?.lng ?? 0,
  );
  dropoffs = twoOpt(dropoffs);
  return [...pickups, ...dropoffs].map((s, i) => ({ ...s, seq: i + 1 }));
}

/** Simple 2-opt improvement for open path length. */
export function twoOpt<T extends { lat: number; lng: number }>(points: T[]): T[] {
  if (points.length < 4) return points;
  const path = [...points];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 40) {
    improved = false;
    for (let i = 0; i < path.length - 2; i++) {
      for (let k = i + 1; k < path.length - 1; k++) {
        const a = path[i];
        const b = path[i + 1];
        const c = path[k];
        const d = path[k + 1];
        const before =
          haversineKm(a.lat, a.lng, b.lat, b.lng) +
          haversineKm(c.lat, c.lng, d.lat, d.lng);
        const after =
          haversineKm(a.lat, a.lng, c.lat, c.lng) +
          haversineKm(b.lat, b.lng, d.lat, d.lng);
        if (after + 0.01 < before) {
          const rev = path.slice(i + 1, k + 1).reverse();
          path.splice(i + 1, k - i, ...rev);
          improved = true;
        }
      }
    }
  }
  return path;
}

export function routeLengthKm(
  stops: Array<{ lat: number; lng: number }>,
): number {
  let sum = 0;
  for (let i = 1; i < stops.length; i++) {
    sum += haversineKm(
      stops[i - 1].lat,
      stops[i - 1].lng,
      stops[i].lat,
      stops[i].lng,
    );
  }
  return sum;
}

/**
 * Shared price split by (weight × distance) over a discounted dedicated pool.
 */
export function splitSharedPrices(
  loads: GeoLoad[],
  dedicatedPoolPaisa: number,
  sharedDiscount = 0.3,
) {
  const pool = Math.round(dedicatedPoolPaisa * (1 - sharedDiscount));
  const factors = loads.map((l) => {
    const d = haversineKm(l.originLat, l.originLng, l.destLat, l.destLng);
    return {
      loadId: l.id,
      distanceKm: d,
      factor: Math.max(0.1, l.weightKg) * Math.max(0.1, d),
      dedicatedAlone:
        Math.round(dedicatedPoolPaisa * (l.weightKg / loads.reduce((s, x) => s + x.weightKg, 0))) ||
        Math.round(dedicatedPoolPaisa / loads.length),
    };
  });
  const sum = factors.reduce((s, f) => s + f.factor, 0) || 1;
  return factors.map((f) => ({
    loadId: f.loadId,
    distanceKm: Number(f.distanceKm.toFixed(1)),
    weightFactor: f.factor,
    pricePaisa: Math.round(pool * (f.factor / sum)),
    dedicatedAlonePaisa: f.dedicatedAlone,
  }));
}
