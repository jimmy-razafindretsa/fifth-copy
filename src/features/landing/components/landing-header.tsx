import Image from "next/image";
import { getT } from "@/i18n";
import styles from "./landing.module.css";

/**
 * Landing header (bible 14.1 item 1, reference `Fifth Copy Landing.dc.html` header). MVP: brand group
 * only; `end` takes the nav, toggles, guest docket and sign-in of later cards.
 */
export async function LandingHeader({ end }: { end?: React.ReactNode }) {
  const t = await getT();
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Image
          className={styles.monogram}
          src="/brand/monogram-red.svg"
          width={40}
          height={40}
          alt=""
          loading="eager"
        />
        <div className={styles.brandName}>{t.brand.name}</div>
      </div>
      {end}
    </header>
  );
}
