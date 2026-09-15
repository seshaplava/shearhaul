"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  clearSession,
  getTokenFor,
  setActiveRole,
} from "@/lib/api";
import { CORRIDORS, type CorridorCode } from "@/lib/corridors";
import styles from "../app.module.css";

const ROLE = "SHIPPER" as const;

type Load = {
  id: string;
  mode: string;
  status: string;
  originAddress: string;
  destAddress: string;
  weightKg: number;
  tripId?: string | null;
};

export default function ShipperHome() {
  const router = useRouter();
  const [loads, setLoads] = useState<Load[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"DEDICATED" | "SHARED" | "RETURN">(
    "DEDICATED",
  );
  const [corridor, setCorridor] = useState<CorridorCode>("BOM-PNQ");
  const [insurance, setInsurance] = useState(true);

  useEffect(() => {
    setActiveRole(ROLE);
    if (!getTokenFor(ROLE)) {
      router.replace("/login?role=SHIPPER");
      return;
    }
    void refresh();
  }, [router]);

  async function refresh() {
    try {
      const data = await api<Load[]>("/loads", {}, ROLE);
      setLoads(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function postLoad() {
    setBusy(true);
    setError(null);
    try {
      const c = CORRIDORS[corridor];
      const now = new Date();
      const load = await api<{ id: string }>(
        "/loads",
        {
          method: "POST",
          body: JSON.stringify({
            mode,
            corridorCode: corridor,
            originLat: c.originLat,
            originLng: c.originLng,
            originAddress: c.originAddress,
            destLat: c.destLat,
            destLng: c.destLng,
            destAddress: c.destAddress,
            weightKg: mode === "SHARED" ? 600 : 1200,
            volumeCft: mode === "SHARED" ? 100 : 200,
            cargoType: "general",
            windowStart: new Date(now.getTime() + 2 * 3600e3).toISOString(),
            windowEnd: new Date(now.getTime() + 12 * 3600e3).toISOString(),
          }),
        },
        ROLE,
      );
      if (insurance) {
        try {
          await api(
            "/insurance/quote",
            {
              method: "POST",
              body: JSON.stringify({ loadId: load.id, select: true }),
            },
            ROLE,
          );
        } catch {
          /* optional */
        }
      }
      router.push(`/shipper/load/${load.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearSession(ROLE);
    router.replace("/login?role=SHIPPER");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          ShareHaul · Shipper
        </Link>
        <div className={styles.topActions}>
          <button className={styles.btnGhost} onClick={() => void refresh()}>
            Refresh
          </button>
          <button className={styles.btn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <h1 className={styles.heading}>Post a load</h1>
          <div className={styles.row}>
            <label className={styles.field}>
              Corridor
              <select
                className={styles.control}
                value={corridor}
                onChange={(e) => setCorridor(e.target.value as CorridorCode)}
              >
                {Object.entries(CORRIDORS).map(([code, c]) => (
                  <option key={code} value={code}>
                    {c.label} ({code})
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Mode
              <select
                className={styles.control}
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "DEDICATED" | "SHARED" | "RETURN")
                }
              >
                <option value="DEDICATED">Dedicated</option>
                <option value="SHARED">Shared</option>
                <option value="RETURN">Return</option>
              </select>
            </label>
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={insurance}
              onChange={(e) => setInsurance(e.target.checked)}
            />
            Add cargo insurance quote
          </label>
          <div className={styles.mt14}>
            <button
              className={styles.btnPrimary}
              disabled={busy}
              onClick={() => void postLoad()}
            >
              {busy ? "Posting…" : `Post ${mode} load`}
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.heading}>My loads</h2>
          {loads.length === 0 ? (
            <p className={styles.muted}>No loads yet</p>
          ) : (
            <div className={styles.list}>
              {loads.map((l) => {
                const canTrack =
                  !!l.tripId ||
                  l.status === "IN_TRIP" ||
                  l.status === "BOOKED" ||
                  l.status === "DELIVERED";
                return (
                  <div key={l.id} className={styles.item}>
                    <button
                      className={styles.itemMain}
                      onClick={() => router.push(`/shipper/load/${l.id}`)}
                    >
                      <span className={styles.itemTitle}>
                        {l.originAddress} → {l.destAddress}
                      </span>
                      <span className={styles.muted}>
                        {l.mode} · {l.status} · {l.weightKg} kg
                      </span>
                    </button>
                    <div className={styles.row}>
                      <span className={styles.badge}>{l.status}</span>
                      {canTrack && (
                        <button
                          className={styles.btnPrimary}
                          onClick={() =>
                            void (async () => {
                              if (l.tripId) {
                                router.push(`/shipper/trip/${l.tripId}`);
                                return;
                              }
                              try {
                                const full = await api<{ tripId?: string | null }>(
                                  `/loads/${l.id}`,
                                  {},
                                  ROLE,
                                );
                                if (full.tripId) {
                                  router.push(`/shipper/trip/${full.tripId}`);
                                } else {
                                  setError(
                                    "No trip linked yet — open the load and use Track trip status",
                                  );
                                  router.push(`/shipper/load/${l.id}`);
                                }
                              } catch (e) {
                                setError(String(e));
                              }
                            })()
                          }
                        >
                          Track
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
