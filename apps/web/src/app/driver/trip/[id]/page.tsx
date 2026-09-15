"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getTokenFor, setActiveRole } from "@/lib/api";
import styles from "../../../app.module.css";

const ROLE = "DRIVER" as const;

const NEXT_STATUS: Record<string, string> = {
  ASSIGNED: "EN_ROUTE_PICKUP",
  EN_ROUTE_PICKUP: "AT_PICKUP",
  AT_PICKUP: "LOADED",
  LOADED: "IN_TRANSIT",
  IN_TRANSIT: "AT_DROPOFF",
  AT_DROPOFF: "DELIVERED",
};

type Stop = {
  id: string;
  seq: number;
  type: string;
  address: string;
  lat: number;
  lng: number;
  pod?: { passed?: boolean };
};

export default function DriverTripPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Record<string, unknown> | null>(null);
  const [returnOffers, setReturnOffers] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [returnInfo, setReturnInfo] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [podBusyId, setPodBusyId] = useState<string | null>(null);

  useEffect(() => {
    setActiveRole(ROLE);
    if (!getTokenFor(ROLE)) {
      router.replace("/login?role=DRIVER");
      return;
    }
    void refresh();
  }, [id, router]);

  async function refresh() {
    const t = await api<Record<string, unknown>>(`/trips/${id}`, {}, ROLE);
    setTrip(t);
    const status = t.status as string;
    if (status === "IN_TRANSIT" || status === "AT_DROPOFF") {
      try {
        const r = await api<{ offers: Array<Record<string, unknown>> }>(
          `/trips/${id}/return-offers`,
          {},
          ROLE,
        );
        setReturnOffers(r.offers ?? []);
        setReturnInfo(
          (r.offers?.length ?? 0) === 0
            ? "No return loads near dropoff yet — post Mode Return on Pune → Mumbai (PNQ-BOM), then Refresh"
            : null,
        );
      } catch (e) {
        setReturnOffers([]);
        setReturnInfo(String(e));
      }
    } else {
      setReturnOffers([]);
      setReturnInfo(
        status
          ? "Return offers appear at IN_TRANSIT or AT_DROPOFF"
          : null,
      );
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setInfo(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setInfo(String(e));
    } finally {
      setBusy(false);
    }
  }

  const status = trip?.status as string | undefined;
  const stops = useMemo(() => {
    const list = ((trip?.stops as Stop[]) ?? []).slice();
    list.sort((a, b) => a.seq - b.seq);
    return list;
  }, [trip]);

  function allPods(type: string) {
    const typed = stops.filter((s) => s.type === type);
    if (!typed.length) return true;
    return typed.every((s) => s.pod?.passed);
  }

  const next = status ? NEXT_STATUS[status] : undefined;
  const needPickup = next === "LOADED" && !allPods("PICKUP");
  const needDropoff = next === "DELIVERED" && !allPods("DROPOFF");
  const canAdvance = !!next && !needPickup && !needDropoff && !busy;

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/driver" className={styles.brand}>
          ← Trips
        </Link>
        <div className={styles.topActions}>
          <button className={styles.btnGhost} onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            className={styles.btn}
            onClick={() => {
              clearSession(ROLE);
              router.replace("/login?role=DRIVER");
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <h1 className={styles.heading}>{status ?? "Trip"}</h1>
          <p className={styles.muted}>
            Mode {String(trip?.mode)} ·{" "}
            {(trip?.vehicle as { regNo?: string } | undefined)?.regNo ?? "—"}
            {" · "}
            trip {String(id).slice(0, 8)}…
          </p>
          {needPickup && (
            <p className={styles.error}>Submit all pickup PODs before LOADED.</p>
          )}
          {needDropoff && (
            <p className={styles.error}>
              Submit all dropoff PODs before DELIVERED.
            </p>
          )}
          <div className={styles.stack} style={{ marginTop: 12 }}>
            <button
              className={styles.btnPrimary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/trips/${id}/accept`, { method: "POST", body: "{}" }, ROLE);
                  setInfo("Accepted");
                })
              }
            >
              1. Accept assignment
            </button>
            <button
              className={styles.btnPrimary}
              disabled={!canAdvance}
              onClick={() =>
                void run(async () => {
                  await api(
                    `/trips/${id}/status`,
                    {
                      method: "POST",
                      body: JSON.stringify({ status: next }),
                    },
                    ROLE,
                  );
                  setInfo(`Moved to ${next}`);
                })
              }
            >
              {next
                ? needPickup || needDropoff
                  ? `2. Advance → ${next} (POD required)`
                  : `2. Advance → ${next}`
                : "2. Advance status"}
            </button>
            <button
              className={styles.btn}
              disabled={busy || !status}
              onClick={() =>
                void run(async () => {
                  await api(
                    "/tracking/points",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        tripId: id,
                        points: [
                          {
                            lat: 18.5204,
                            lng: 73.8567,
                            speed: 40,
                            recordedAt: new Date().toISOString(),
                          },
                        ],
                      }),
                    },
                    ROLE,
                  );
                  setInfo("GPS point sent");
                })
              }
            >
              3. Send GPS point
            </button>
          </div>
          {info && <p className={styles.muted}>{info}</p>}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.heading}>Stops (POD per stop)</h2>
          <div className={styles.list}>
            {stops.map((s) => (
              <div key={s.id} className={styles.item}>
                <div>
                  <span className={styles.itemTitle}>
                    {s.seq}. {s.type} · {s.address}
                  </span>
                  <span className={styles.muted}>
                    {s.pod?.passed ? "POD passed" : "POD required"}
                  </span>
                </div>
                <div className={styles.row}>
                  <a
                    className={styles.btnGhost}
                    href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Map
                  </a>
                  <button
                    className={styles.btnPrimary}
                    disabled={!!s.pod?.passed || podBusyId === s.id}
                    onClick={() =>
                      void (async () => {
                        setPodBusyId(s.id);
                        setInfo(null);
                        try {
                          const res = await api<{ message?: string }>(
                            `/trips/${id}/pod`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                stopId: s.id,
                                otp: "000000",
                                lat: s.lat,
                                lng: s.lng,
                                signatureOk: true,
                              }),
                            },
                            ROLE,
                          );
                          setInfo(res.message ?? `POD for stop ${s.seq}`);
                          await refresh();
                        } catch (e) {
                          setInfo(String(e));
                        } finally {
                          setPodBusyId(null);
                        }
                      })()
                    }
                  >
                    {s.pod?.passed
                      ? "Done"
                      : podBusyId === s.id
                        ? "Saving…"
                        : `POD #${s.seq}`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {(returnOffers.length > 0 || returnInfo) && (
          <section className={styles.panel}>
            <h2 className={styles.heading}>Return offers near dropoff</h2>
            {returnInfo && <p className={styles.muted}>{returnInfo}</p>}
            {returnOffers.map((o) => {
              const b = (o.priceBreakdown as Record<string, unknown>) ?? {};
              return (
                <div key={String(o.id)} className={styles.offer}>
                  <div className={styles.offerTop}>
                    <div>
                      <div className={styles.price}>
                        ₹{((o.pricePaisa as number) / 100).toFixed(0)}
                      </div>
                      <div className={styles.muted}>
                        {String(b.origin ?? "")} → {String(b.dest ?? "")}
                        <br />
                        {String(b.distKm)} km · toward home{" "}
                        {String(b.towardHomeKm ?? "—")} km
                      </div>
                    </div>
                    <button
                      className={styles.btnPrimary}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const res = await api<{ trip?: { id: string } }>(
                            `/offers/${o.id}/accept-return`,
                            { method: "POST", body: "{}" },
                            ROLE,
                          );
                          setInfo(
                            `Return trip ${res.trip?.id?.slice(0, 8) ?? "booked"}`,
                          );
                        })
                      }
                    >
                      Take
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
