import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MapsProvider } from '../ports';

function haversineKm(
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

@Injectable()
export class HaversineMapsProvider implements MapsProvider {
  readonly name = 'haversine';

  async distanceKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ) {
    return haversineKm(a.lat, a.lng, b.lat, b.lng);
  }

  staticMapUrl() {
    return null;
  }
}

@Injectable()
export class GoogleMapsProvider implements MapsProvider {
  readonly name = 'google';
  constructor(private readonly config: ConfigService) {}

  async distanceKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ) {
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key) {
      return haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
    const url = new URL(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
    );
    url.searchParams.set('origins', `${a.lat},${a.lng}`);
    url.searchParams.set('destinations', `${b.lat},${b.lng}`);
    url.searchParams.set('key', key);
    url.searchParams.set('units', 'metric');
    const res = await fetch(url);
    const data = (await res.json()) as {
      rows?: { elements?: { distance?: { value: number }; status: string }[] }[];
    };
    const meters = data.rows?.[0]?.elements?.[0]?.distance?.value;
    if (meters == null) return haversineKm(a.lat, a.lng, b.lat, b.lng);
    return meters / 1000;
  }

  staticMapUrl(params: { lat: number; lng: number; zoom?: number }) {
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key) return null;
    const zoom = params.zoom ?? 12;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${params.lat},${params.lng}&zoom=${zoom}&size=600x300&markers=color:green%7C${params.lat},${params.lng}&key=${key}`;
  }
}
