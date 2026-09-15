import Link from "next/link";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroPlane} aria-hidden>
          <div className={styles.sky} />
          <div className={styles.horizon} />
          <div className={styles.highway}>
            <div className={styles.shoulder} />
            <div className={styles.laneMark} />
          </div>
          <div className={styles.truck}>
            <div className={styles.cab} />
            <div className={styles.trailer} />
            <div className={styles.wheel} />
            <div className={`${styles.wheel} ${styles.wheelRear}`} />
          </div>
          <div className={styles.dust} />
        </div>

        <header className={styles.top}>
          <span className={styles.logo}>ShareHaul</span>
          <nav className={styles.nav}>
            <Link className={styles.navLink} href="/login?role=SHIPPER">
              Shipper
            </Link>
            <Link className={styles.navLink} href="/login?role=DRIVER">
              Driver
            </Link>
            <Link className={styles.ctaNav} href="/login?role=SHIPPER">
              Book a truck
            </Link>
          </nav>
        </header>

        <div className={styles.heroCopy}>
          <p className={styles.brand}>ShareHaul</p>
          <p className={styles.lead}>
            Intercity freight across India — dedicated trucks, shared capacity,
            or return miles with escrow and live POD.
          </p>
          <div className={styles.ctaRow}>
            <Link className={styles.primary} href="/login?role=SHIPPER">
              Ship cargo
            </Link>
            <Link className={styles.secondary} href="/login?role=DRIVER">
              Drive loads
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.modes}>
        <h2 className={styles.modesTitle}>Three ways to move cargo</h2>
        <p className={styles.modesSub}>
          Pick the mode that fits your timeline and budget.
        </p>
        <div className={styles.modeList}>
          <div className={styles.modeRow}>
            <span className={styles.modeIndex}>01</span>
            <div>
              <h3 className={styles.modeCardTitle}>Dedicated</h3>
              <p className={styles.modeCardText}>
                Full truck for your load — fastest assignment on live corridors.
              </p>
            </div>
          </div>
          <div className={styles.modeRow}>
            <span className={styles.modeIndex}>02</span>
            <div>
              <h3 className={styles.modeCardTitle}>Shared</h3>
              <p className={styles.modeCardText}>
                Split capacity and cost with co-loads. Weight×distance pricing.
              </p>
            </div>
          </div>
          <div className={styles.modeRow}>
            <span className={styles.modeIndex}>03</span>
            <div>
              <h3 className={styles.modeCardTitle}>Return</h3>
              <p className={styles.modeCardText}>
                Fill empty miles near dropoff. Better rates for reverse trips.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>ShareHaul web · API :3000 · Admin :3001</span>
        <Link href="http://localhost:3001">Ops admin</Link>
      </footer>
    </div>
  );
}
