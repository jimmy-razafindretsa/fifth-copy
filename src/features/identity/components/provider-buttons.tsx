import { continueWithProvider } from "../actions/continue-with-provider";
import type { OAuthProviderId } from "../schema";
import styles from "./auth.module.css";
import { ProviderMark } from "./provider-marks";

export type ProviderLabels = {
  or: string;
  github: string;
  discord: string;
  google: string;
  age: string;
};

/**
 * GitHub, Discord and Google (#36 C8, R164; Google from the owner's C18 review): 7.1 secondary buttons
 * under an OR rule, each led by its monochrome provider mark (bible 7.1 extension), then the age line
 * (every provider is 13+; younger students use a username or play as guests). Each is a form posting
 * to `continueWithProvider`, so it works before hydration; the OAuth flow itself is #49's.
 */
export function ProviderButtons({
  labels,
  providers,
  callbackUrl,
}: {
  labels: ProviderLabels;
  /** The providers to offer, in button order (#49 C2: an unconfigured one is hidden). */
  providers: readonly OAuthProviderId[];
  callbackUrl?: string | null;
}) {
  return (
    <>
      <p className={styles.or} aria-hidden="true">
        {labels.or}
      </p>
      <div className={styles.providers}>
        {providers.map((provider) => (
          <form key={provider} action={continueWithProvider}>
            <input type="hidden" name="provider" value={provider} />
            {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
            <button type="submit" className={styles.secondary}>
              <ProviderMark provider={provider} />
              <span>{labels[provider]}</span>
            </button>
          </form>
        ))}
      </div>
      <p className={styles.note}>{labels.age}</p>
    </>
  );
}
