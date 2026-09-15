export type LoadMode = 'DEDICATED' | 'SHARED';

export type TripStatus =
  | 'DRAFT'
  | 'MATCHING'
  | 'ASSIGNED'
  | 'EN_ROUTE_PICKUP'
  | 'AT_PICKUP'
  | 'LOADED'
  | 'IN_TRANSIT'
  | 'AT_DROPOFF'
  | 'DELIVERED'
  | 'SETTLING'
  | 'SETTLED'
  | 'CANCELLED'
  | 'DISPUTED';

export interface ApiHealth {
  status: 'ok';
  service: string;
  ts: string;
}
