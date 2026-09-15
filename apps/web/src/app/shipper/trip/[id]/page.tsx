"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getTokenFor, setActiveRole } from "@/lib/api";
import styles from "../../../app.module.css";

const ROLE = "SHIPPER" as const;

export default function ShipperTripPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Record<string, unknown> | null>(null);
  const [location, setLocation] = useState<Record<string, unknown> | null>(
    null,
  );
  const [docs, setDocs] = useState<unknown[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveRole(ROLE);
    if (!getTokenFor(ROLE)) {
      router.replace("/login?role=SHIPPER");
      return;
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [id, router]);

  async function refresh() {
    try {
      const t = await api<Record<string, unknown>>(`/trips/${id}`, {}, ROLE);
      const loc = await api<{ location?: Record<string, unknown> }>(
        `/trips/${id}/location`,
        {},
        ROLE,
      );
      let d: unknown[] = [];
      try {
        d = await api<unknown[]>(`/documents/trip/${id}`, {}, ROLE);
      } catch {
        /* empty */
      }
      setTrip(t);
      setLocation(loc.location ?? null);
      setDocs(d);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function issueDocs() {
    try {
      await api(`/documents/trip/${id}/lr`, { method: "POST", body: "{}" }, ROLE);
      await api(
        `/documents/trip/${id}/invoice`,
        { method: "POST", body: "{}" },
        ROLE,
      );
      setInfo("LR + invoice issued");
      await refresh();
    } catch (e) {
      setInfo(String(e));
    }
  }

  async function openClaim() {
    try {
      await api(
        "/claims",
        {
          method: "POST",
          body: JSON.stringify({
            tripId: id,
            type: "DAMAGE",
            notes: "Opened from web",
            amountClaimed: 50000,
          }),
        },
        ROLE,
      );
      setInfo("Claim opened");
      await refresh();
    } catch (e) {
      setInfo(String(e));
    }
  }

  const stops = (trip?.stops as Array<Record<string, unknown>>) ?? [];
  const payments = (trip?.payments as Array<Record<string, unknown>>) ?? [];

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/shipper" className={styles.brand}>
          ← Shipper
        </Link>
        <div className={styles.topActions}>
          <button className={styles.btnGhost} onClick={() => void refresh()}>
            Refresh
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
          <h1 className={styles.heading}>Track trip</h1>
          <p className={styles.muted}>
            Auto-updates every 4s · trip {String(id).slice(0, 8)}…
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <p>
            Status: <span className={styles.itemTitle}>{String(trip?.status ?? "…")}</span>
          </p>
          <p className={styles.muted}>
            Location:{" "}
            {location
              ? `${location.lat}, ${location.lng}`
              : "waiting for GPS"}
          </p>
          {location && (
            <a
              className={styles.btn}
              href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps
            </a>
          )}
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Payments:{" "}
            {payments.map((p) => `${p.status}/${p.gatewayProvider ?? ""}`).join(", ") ||
              "—"}
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.heading}>Stops</h2>
          <div className={styles.stack}>
            {stops.map((s) => {
              const pod = s.pod as { passed?: boolean } | undefined;
              return (
                <div key={String(s.id)} className={styles.item}>
                  <div>
                    <span className={styles.itemTitle}>
                      {String(s.seq)}. {String(s.type)} · {String(s.address)}
                    </span>
                    <span className={styles.muted}>
                      {pod?.passed ? "POD ✓" : "POD pending"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.row}>
            <button className={styles.btnPrimary} onClick={() => void issueDocs()}>
              Issue LR + invoice
            </button>
            <button className={styles.btn} onClick={() => void openClaim()}>
              Open damage claim
            </button>
          </div>
          {docs.length > 0 && (
            <p className={styles.muted} style={{ marginTop: 10 }}>
              Docs:{" "}
              {(docs as Array<{ docType: string }>).map((d) => d.docType).join(", ")}
            </p>
          )}
          {info && <p className={styles.muted}>{info}</p>}
        </section>
      </main>
    </div>
  );
}
