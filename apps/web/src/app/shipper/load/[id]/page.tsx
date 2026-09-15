"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getTokenFor, setActiveRole } from "@/lib/api";
import styles from "../../../app.module.css";

const ROLE = "SHIPPER" as const;

type Offer = {
  id: string;
  pricePaisa: number;
  priceBreakdown?: {
    regNo?: string;
    coLoadCount?: number;
    inrSaved?: number;
    etaRangeMin?: number;
    etaRangeMax?: number;
    routeKm?: number;
    soloShared?: boolean;
    splitMethod?: string;
    joinBeforeStart?: boolean;
    joinTripId?: string;
  };
};

export default function ShipperLoadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [load, setLoad] = useState<Record<string, unknown> | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActiveRole(ROLE);
    if (!getTokenFor(ROLE)) {
      router.replace("/login?role=SHIPPER");
      return;
    }
    void refresh();
  }, [id, router]);

  async function refresh() {
    try {
      const l = await api<Record<string, unknown>>(`/loads/${id}`, {}, ROLE);
      const o = await api<{
        offers: Offer[];
        canConvertDedicated?: boolean;
        aloneFallback?: string;
        sharedWaitEndsAt?: string;
      }>(`/loads/${id}/offers`, {}, ROLE);
      setLoad(l);
      setOffers(o.offers ?? []);
      setMeta(o as unknown as Record<string, unknown>);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function selectOffer(offerId: string) {
    setBusy(true);
    try {
      const res = await api<{
        trip: { id: string };
        payment?: { status?: string };
        checkout?: Record<string, unknown>;
      }>(`/offers/${offerId}/select`, { method: "POST", body: "{}" }, ROLE);
      const tripId = res.trip.id;
      if (res.payment?.status === "CREATED") {
        await api(
          `/payments/trip/${tripId}/mock-confirm`,
          { method: "POST", body: "{}" },
          ROLE,
        );
      }
      router.push(`/shipper/trip/${tripId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function convertDedicated() {
    setBusy(true);
    try {
      await api(
        `/loads/${id}/convert-dedicated`,
        { method: "POST", body: "{}" },
        ROLE,
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/shipper" className={styles.brand}>
          ← Loads
        </Link>
        <div className={styles.topActions}>
          <button className={styles.btnGhost} onClick={() => void refresh()}>
            Refresh offers
          </button>
          <button
            className={styles.btn}
            onClick={() => {
              clearSession(ROLE);
              router.replace("/login?role=SHIPPER");
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <h1 className={styles.heading}>Load & offers</h1>
          {load && (
            <p className={styles.muted}>
              {String(load.originAddress)} → {String(load.destAddress)}
              <br />
              {String(load.mode)} · {String(load.status)}
            </p>
          )}
          {load?.tripId ? (
            <div className={styles.mt12}>
              <button
                className={styles.btnPrimary}
                onClick={() =>
                  router.push(`/shipper/trip/${String(load.tripId)}`)
                }
              >
                Track trip status
              </button>
            </div>
          ) : null}
          {load?.mode === "SHARED" && (
            <div style={{ marginTop: 12 }}>
              <p className={styles.muted}>
                Wait ends: {String(meta.sharedWaitEndsAt ?? "—")} ·{" "}
                {String(meta.aloneFallback ?? "")}
              </p>
              {(meta.canConvertDedicated ||
                offers.some((o) => o.priceBreakdown?.soloShared)) && (
                <button
                  className={styles.btn}
                  disabled={busy}
                  onClick={() => void convertDedicated()}
                >
                  Convert to Dedicated
                </button>
              )}
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.heading}>Offers</h2>
          {offers.length === 0 ? (
            <p className={styles.muted}>No offers yet — refresh shortly</p>
          ) : (
            offers.map((o) => {
              const b = o.priceBreakdown ?? {};
              return (
                <div key={o.id} className={styles.offer}>
                  <div className={styles.offerTop}>
                    <div>
                      <div className={styles.price}>
                        ₹{(o.pricePaisa / 100).toFixed(0)}
                      </div>
                      <div className={styles.muted}>
                        {b.regNo ?? "truck"}
                        {b.joinBeforeStart
                          ? " · JOIN open trip"
                          : b.coLoadCount != null
                            ? ` · co-loads ${b.coLoadCount}`
                            : ""}
                        {b.inrSaved != null ? ` · save ₹${b.inrSaved}` : ""}
                      </div>
                      <div className={styles.muted}>
                        {b.etaRangeMin != null
                          ? `ETA ${b.etaRangeMin}–${b.etaRangeMax}h`
                          : ""}
                        {b.routeKm != null ? ` · route ~${b.routeKm} km` : ""}
                        {b.splitMethod ? ` · ${b.splitMethod}` : ""}
                      </div>
                    </div>
                    <button
                      className={styles.btnPrimary}
                      disabled={busy}
                      onClick={() => void selectOffer(o.id)}
                    >
                      {b.joinBeforeStart ? "Join truck" : "Select"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
