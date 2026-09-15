"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, saveSession } from "@/lib/api";
import styles from "./login.module.css";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialRole =
    params.get("role") === "DRIVER" ? "DRIVER" : "SHIPPER";

  const [role, setRole] = useState<"SHIPPER" | "DRIVER">(initialRole);
  const [phone, setPhone] = useState(
    initialRole === "DRIVER" ? "9000000003" : "9111111111",
  );
  const [otp, setOtp] = useState("123456");
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hint = useMemo(
    () =>
      role === "DRIVER"
        ? "Demo drivers: 9000000001 · 0002 · 0003"
        : "Demo shipper: 9111111111",
    [role],
  );

  async function requestOtp() {
    setBusy(true);
    setInfo(null);
    try {
      const res = await api<{ devCode?: string }>("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, role }),
      });
      setInfo(`OTP sent. Dev code: ${res.devCode ?? "check SMS"}`);
    } catch (e) {
      setInfo(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setInfo(null);
    try {
      const res = await api<{ accessToken: string }>("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ phone, code: otp, role }),
      });
      saveSession(res.accessToken, role);
      try {
        await api("/devices/token", {
          method: "POST",
          body: JSON.stringify({
            token: `web-${role.toLowerCase()}-${phone}`,
            platform: "web",
          }),
        });
      } catch {
        /* optional */
      }
      router.replace(role === "DRIVER" ? "/driver" : "/shipper");
    } catch (err) {
      setInfo(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <aside className={styles.stage} aria-hidden={false}>
        <Link href="/" className={styles.back}>
          ← Home
        </Link>
        <div className={styles.stageRoad}>
          <div className={styles.stageLane} />
        </div>
        <div className={styles.stageCopy}>
          <p className={styles.stageBrand}>ShareHaul</p>
          <p className={styles.stageLead}>
            Escrow, corridor matching, and proof of delivery — one portal for
            shippers and drivers.
          </p>
        </div>
      </aside>

      <div className={styles.formWrap}>
        <Link href="/" className={styles.backOnForm}>
          ← ShareHaul
        </Link>
        <form className={styles.card} onSubmit={verify}>
          <p className={styles.brand}>ShareHaul</p>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.sub}>
            OTP login for the web shipper and driver portals.
          </p>

          <div className={styles.roles}>
            <button
              type="button"
              className={`${styles.roleBtn} ${role === "SHIPPER" ? styles.active : ""}`}
              onClick={() => {
                setRole("SHIPPER");
                setPhone("9111111111");
              }}
            >
              Shipper
            </button>
            <button
              type="button"
              className={`${styles.roleBtn} ${role === "DRIVER" ? styles.active : ""}`}
              onClick={() => {
                setRole("DRIVER");
                setPhone("9000000003");
              }}
            >
              Driver
            </button>
          </div>

          <label className={styles.label}>
            Phone
            <input
              className={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              required
            />
          </label>
          <label className={styles.label}>
            OTP
            <input
              className={styles.input}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />
          </label>
          <p className={styles.hint}>{hint} · OTP usually 123456</p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={busy}
              onClick={requestOtp}
            >
              Request OTP
            </button>
            <button
              type="submit"
              className={`${styles.actionBtn} ${styles.primary}`}
              disabled={busy}
            >
              Verify & continue
            </button>
          </div>
          {info && <p className={styles.info}>{info}</p>}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className={styles.page}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
