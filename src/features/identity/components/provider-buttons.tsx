import { continueWithProvider } from "../actions/continue-with-provider";
import styles from "./auth.module.css";

export type ProviderLabels = { or: string; github: string; discord: string; age: string };

/**
 * GitHub and Discord (#36 C8, R164): two 7.1 secondary buttons under an OR rule, then the age line
 * (both providers are 13+; younger students use a username or play as guests). Each is a form posting
 * to `continueWithProvider`, so it works before hydration; the OAuth flow itself is #49's.
 */
export function ProviderButtons({
  labels,
  callbackUrl,
}: {
  labels: ProviderLabels;
  callbackUrl?: string | null;
}) {
  return (
    <>
      <p className={styles.or} aria-hidden="true">
        {labels.or}
      </p>
      <div className={styles.providers}>
        {(["github", "discord"] as const).map((provider) => (
          <form key={provider} action={continueWithProvider}>
            <input type="hidden" name="provider" value={provider} />
            {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
            <button type="submit" className={styles.secondary}>
              {labels[provider]}
            </button>
          </form>
        ))}
      </div>
      <p className={styles.note}>{labels.age}</p>
    </>
  );
}
