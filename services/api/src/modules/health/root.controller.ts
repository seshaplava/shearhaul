import { Controller, Get } from '@nestjs/common';

@Controller()
export class RootController {
  @Get()
  root() {
    return {
      name: 'ShareHaul API',
      version: 'v1',
      status: 'ok',
      docs: 'See README for routes',
        endpoints: {
        health: 'GET /v1/health',
        authOtpRequest: 'POST /v1/auth/otp/request',
        authOtpVerify: 'POST /v1/auth/otp/verify',
        me: 'GET /v1/auth/me',
        createLoad: 'POST /v1/loads',
        listLoads: 'GET /v1/loads',
        loadOffers: 'GET /v1/loads/:id/offers',
        convertDedicated: 'POST /v1/loads/:id/convert-dedicated',
        selectOffer: 'POST /v1/offers/:id/select',
        acceptReturn: 'POST /v1/offers/:id/accept-return',
        returnOffers: 'GET /v1/trips/:id/return-offers',
        tripAccept: 'POST /v1/trips/:id/accept',
        tripStatus: 'POST /v1/trips/:id/status',
        tripPod: 'POST /v1/trips/:id/pod',
        trackingPoints: 'POST /v1/tracking/points',
        tripLocation: 'GET /v1/trips/:id/location',
        paymentsByTrip: 'GET /v1/payments/trip/:tripId',
        claims: 'POST /v1/claims',
        kyc: 'GET /v1/kyc/status',
        adminTrips: 'GET /v1/admin/trips',
        corridors: 'GET /v1/catalog/corridors',
        flags: 'GET /v1/flags',
        adminOverview: 'GET /v1/admin/overview',
        i18n: 'GET /v1/i18n/en',
      },
    };
  }
}
