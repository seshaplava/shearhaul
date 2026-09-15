import { OpsConsole } from "./OpsConsole";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/v1";

async function fetchJson(path: string) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const [overview, trips, claims, kyc, corridors] = await Promise.all([
    fetchJson("/admin/overview"),
    fetchJson("/admin/trips"),
    fetchJson("/admin/claims"),
    fetchJson("/admin/kyc"),
    fetchJson("/catalog/corridors"),
  ]);

  return (
    <OpsConsole
      overview={overview}
      trips={Array.isArray(trips) ? trips : []}
      claims={Array.isArray(claims) ? claims : []}
      kyc={Array.isArray(kyc) ? kyc : []}
      corridors={Array.isArray(corridors) ? corridors : []}
    />
  );
}
