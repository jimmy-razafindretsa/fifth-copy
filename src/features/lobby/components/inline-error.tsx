import styles from "./lobby-entry.module.css";

/**
 * The lobby feature's inline error: a docket line (bible 7.4) with the `RETURNED ·` rejection word
 * (bible 7.7). No hooks and no catalog lookup, so server and client callers pass their own strings.
 */
export function InlineError({
  id,
  prefix,
  children,
}: {
  id?: string;
  prefix: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} role="alert" className={styles.errorLine}>
      <span className={styles.errorPrefix}>{prefix}</span> {children}
    </p>
  );
}
