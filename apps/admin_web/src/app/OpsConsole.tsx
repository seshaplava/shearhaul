"use client";

import { useMemo, useState, useTransition } from "react";
import styles from "./page.module.css";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/v1";

type Overview = {
  users: number;
  loads: number;
  trips: number;
  payments: number;
  claims: number;
  openClaims?: number;
  pendingKyc?: number;
  flags: { key: string; enabled: boolean }[];
};

type TripRow = {
  id: string;
  status: string;
  mode?: string;
  vehicle?: { regNo?: string };
  savings?: { inrSaved?: number };
  payments?: { status: string }[];
};

type ClaimRow = {
  id: string;
  type: string;
  status: string;
  tripId: string;
  amountClaimed?: number | null;
};

type KycRow = {
  id: string;
  docType: string;
  status: string;
  userId: string;
};

type Corridor = {
  code: string;
  originCity: string;
  destCity: string;
  active: boolean;
};

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patchJson(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function OpsConsole({
  overview,
  trips,
  claims,
  kyc,
  corridors,
}: {
  overview: Overview | null;
  trips: TripRow[];
  claims: ClaimRow[];
  kyc: KycRow[];
  corridors: Corridor[];
}) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [claimFilter, setClaimFilter] = useState("ALL");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tripRows] = useState(trips);
  const [claimRows, setClaimRows] = useState(claims);
  const [kycRows, setKycRows] = useState(kyc);
  const [flags, setFlags] = useState(overview?.flags ?? []);

  const filteredTrips = useMemo(() => {
    return tripRows.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (modeFilter !== "ALL" && t.mode !== modeFilter) return false;
      return true;
    });
  }, [tripRows, statusFilter, modeFilter]);

  const filteredClaims = useMemo(() => {
    return claimRows.filter(
      (c) => claimFilter === "ALL" || c.status === claimFilter,
    );
  }, [claimRows, claimFilter]);

  function run(label: string, fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        setMessage(label);
      } catch (e) {
        setMessage(String(e));
      }
    });
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.brand}>ShareHaul</p>
            <h1 className={styles.title}>Ops console</h1>
            <p className={styles.sub}>
              Trips · claims · KYC · corridors · feature flags
            </p>
          </div>
          {message && <p className={styles.toast}>{message}</p>}
        </header>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Overview</h2>
          {overview ? (
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statStrong}>{overview.users}</span>
                <span className={styles.statLabel}>users</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statStrong}>{overview.loads}</span>
                <span className={styles.statLabel}>loads</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statStrong}>{overview.trips}</span>
                <span className={styles.statLabel}>trips</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statStrong}>
                  {overview.openClaims ?? overview.claims}
                </span>
                <span className={styles.statLabel}>open claims</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statStrong}>
                  {overview.pendingKyc ?? 0}
                </span>
                <span className={styles.statLabel}>KYC queue</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statStrong}>{overview.payments}</span>
                <span className={styles.statLabel}>payments</span>
              </div>
            </div>
          ) : (
            <p className={styles.muted}>API offline at {API_BASE}</p>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Feature flags</h2>
          <div className={styles.flagGrid}>
            {flags.map((f) => (
              <button
                key={f.key}
                className={f.enabled ? styles.flagOn : styles.flagOff}
                disabled={pending}
                onClick={() =>
                  run(`Flag ${f.key} → ${!f.enabled ? "ON" : "OFF"}`, async () => {
                    await patchJson(`/admin/flags/${encodeURIComponent(f.key)}`, {
                      enabled: !f.enabled,
                    });
                    setFlags((prev) =>
                      prev.map((x) =>
                        x.key === f.key ? { ...x, enabled: !x.enabled } : x,
                      ),
                    );
                  })
                }
              >
                <code className={styles.mono}>{f.key}</code>
                <span className={styles.flagLabel}>
                  {f.enabled ? "ON" : "OFF"}
                </span>
              </button>
            ))}
            {flags.length === 0 && (
              <p className={styles.muted}>No flags yet</p>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Corridors</h2>
          <div className={styles.chipRow}>
            {corridors.map((c) => (
              <span key={c.code} className={styles.chip}>
                {c.code} · {c.originCity}→{c.destCity}
              </span>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHead}>
            <h2 className={styles.cardTitle}>Trips</h2>
            <div className={styles.filters}>
              <select
                className={styles.select}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All statuses</option>
                {[
                  "ASSIGNED",
                  "IN_TRANSIT",
                  "DELIVERED",
                  "SETTLED",
                  "DISPUTED",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value)}
              >
                <option value="ALL">All modes</option>
                <option value="DEDICATED">DEDICATED</option>
                <option value="SHARED">SHARED</option>
                <option value="RETURN">RETURN</option>
              </select>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Mode</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}>Vehicle</th>
                  <th className={styles.th}>Pay</th>
                  <th className={styles.th}>Saved ₹</th>
                  <th className={styles.th}>Id</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrips.slice(0, 30).map((t) => (
                  <tr key={t.id}>
                    <td className={styles.td}>{t.mode}</td>
                    <td className={styles.td}>
                      <span className={styles.badge}>{t.status}</span>
                    </td>
                    <td className={styles.td}>{t.vehicle?.regNo ?? "—"}</td>
                    <td className={styles.td}>
                      {(t.payments ?? []).map((p) => p.status).join(", ") ||
                        "—"}
                    </td>
                    <td className={styles.td}>{t.savings?.inrSaved ?? "—"}</td>
                    <td className={styles.td}>
                      <code className={styles.mono}>{t.id.slice(0, 8)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredTrips.length === 0 && (
            <p className={styles.muted}>No trips match filters</p>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHead}>
            <h2 className={styles.cardTitle}>Claims</h2>
            <select
              className={styles.select}
              value={claimFilter}
              onChange={(e) => setClaimFilter(e.target.value)}
            >
              <option value="ALL">All</option>
              <option value="OPEN">OPEN</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Type</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}>Amount</th>
                  <th className={styles.th}>Trip</th>
                  <th className={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredClaims.map((c) => (
                  <tr key={c.id}>
                    <td className={styles.td}>{c.type}</td>
                    <td className={styles.td}>{c.status}</td>
                    <td className={styles.td}>{c.amountClaimed ?? "—"}</td>
                    <td className={styles.td}>
                      <code className={styles.mono}>{c.tripId.slice(0, 8)}</code>
                    </td>
                    <td className={`${styles.td} ${styles.actions}`}>
                      <button
                        className={styles.actionBtn}
                        disabled={pending || c.status !== "OPEN"}
                        onClick={() =>
                          run("Claim approved", async () => {
                            await postJson(`/admin/claims/${c.id}/review`, {
                              status: "APPROVED",
                              notes: "Approved from ops console",
                            });
                            setClaimRows((rows) =>
                              rows.map((r) =>
                                r.id === c.id
                                  ? { ...r, status: "APPROVED" }
                                  : r,
                              ),
                            );
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        className={styles.actionBtn}
                        disabled={pending || c.status !== "OPEN"}
                        onClick={() =>
                          run("Claim rejected", async () => {
                            await postJson(`/admin/claims/${c.id}/review`, {
                              status: "REJECTED",
                              notes: "Rejected from ops console",
                            });
                            setClaimRows((rows) =>
                              rows.map((r) =>
                                r.id === c.id
                                  ? { ...r, status: "REJECTED" }
                                  : r,
                              ),
                            );
                          })
                        }
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredClaims.length === 0 && (
            <p className={styles.muted}>No claims</p>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>KYC queue</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Doc</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}>User</th>
                  <th className={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {kycRows.map((d) => (
                  <tr key={d.id}>
                    <td className={styles.td}>{d.docType}</td>
                    <td className={styles.td}>{d.status}</td>
                    <td className={styles.td}>
                      <code className={styles.mono}>{d.userId.slice(0, 8)}</code>
                    </td>
                    <td className={`${styles.td} ${styles.actions}`}>
                      <button
                        className={styles.actionBtn}
                        disabled={pending}
                        onClick={() =>
                          run("KYC verified", async () => {
                            await postJson(`/admin/kyc/${d.id}/review`, {
                              status: "VERIFIED",
                            });
                            setKycRows((rows) =>
                              rows.filter((r) => r.id !== d.id),
                            );
                          })
                        }
                      >
                        Verify
                      </button>
                      <button
                        className={styles.actionBtn}
                        disabled={pending}
                        onClick={() =>
                          run("KYC rejected", async () => {
                            await postJson(`/admin/kyc/${d.id}/review`, {
                              status: "REJECTED",
                              notes: "Rejected from ops",
                            });
                            setKycRows((rows) =>
                              rows.filter((r) => r.id !== d.id),
                            );
                          })
                        }
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {kycRows.length === 0 && (
            <p className={styles.muted}>No pending KYC</p>
          )}
        </section>
      </main>
    </div>
  );
}
