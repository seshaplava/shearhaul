"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getTokenFor, setActiveRole } from "@/lib/api";
import styles from "../app.module.css";

const ROLE = "DRIVER" as const;

type Trip = {
  id: string;
  status: string;
  mode: string;
  vehicle?: { regNo?: string };
};

export default function DriverHome() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveRole(ROLE);
    if (!getTokenFor(ROLE)) {
      router.replace("/login?role=DRIVER");
      return;
    }
    void refresh();
  }, [router]);

  async function refresh() {
    try {
      const data = await api<Trip[]>("/trips", {}, ROLE);
      setTrips(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          ShareHaul · Driver
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
          <h1 className={styles.heading}>My trips</h1>
          {error && <p className={styles.error}>{error}</p>}
          {trips.length === 0 ? (
            <p className={styles.muted}>
              No trips for this driver. Try 9000000002 or 9000000003 if the
              latest booking is on another demo truck.
            </p>
          ) : (
            <div className={styles.list}>
              {trips.map((t) => (
                <button
                  key={t.id}
                  className={styles.item}
                  onClick={() => router.push(`/driver/trip/${t.id}`)}
                >
                  <div>
                    <span className={styles.itemTitle}>
                      {t.status} · {t.vehicle?.regNo ?? "truck"}
                    </span>
                    <span className={styles.muted}>
                      {t.mode} · {t.id.slice(0, 8)}
                    </span>
                  </div>
                  <span className={styles.badge}>{t.mode}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
