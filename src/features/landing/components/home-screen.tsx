import type { ReactNode } from "react";
import { HomeMenu, type HomeMenuProps } from "./home-menu";
import styles from "./home.module.css";

type Props = {
  /** The wordmark text (the page's one `h1`). */
  title: string;
  /** The tilted kicker band under the wordmark. */
  band: string;
  menu: HomeMenuProps;
  /** The player docket (#945), top right; above the menu on phones. */
  docket?: ReactNode;
  /** The clerk stage (#946), the right half from 768px. */
  stage?: ReactNode;
};

/**
 * The Home menu screen (#943; bible "Home menu (extension, #943)"): `/` for a viewer. A server shell; the
 * menu leaf owns selection and keys, the streamed parts (docket, mission, online figure, stars) come in
 * as nodes from the route, so the menu is usable before any of them.
 */
export function HomeScreen({ title, band, menu, docket, stage }: Props) {
  return (
    <main className={styles.screen} data-home-screen>
      {docket ? <div className={styles.docketSlot}>{docket}</div> : null}
      <div className={styles.column}>
        <div className={styles.brand}>
          <h1 className={styles.wordmark}>{title}</h1>
          <span className={styles.band}>{band}</span>
        </div>
        <HomeMenu {...menu} />
      </div>
      {stage}
    </main>
  );
}
