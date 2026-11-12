import { Alert } from "@/components/ui";
import { env } from "@/env";
import { getT } from "@/i18n";
import { enabledOAuthProviders } from "@/server/auth";
import { signInAction } from "../actions/sign-in";
import { signUpAction } from "../actions/sign-up";
import { AuthForm, type AuthFormLabels } from "./auth-form";
import styles from "./auth.module.css";
import { GuestCta } from "./guest-cta";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "../schema";
import { ProviderButtons } from "./provider-buttons";

export type AuthMode = "sign-in" | "sign-up";

/**
 * The routes of the form screens (ARCHITECTURE 8.1). A link appears when its route ships (bible 14.3,
 * #875); the privacy page shipped with #76. `privacy` stays optional so a held-back page can drop out.
 */
export const AUTH_LINKS: { signIn: string; signUp: string; recover: string; privacy?: string } = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  recover: "/recover",
  privacy: "/privacy",
};

type Messages = Awaited<ReturnType<typeof getT>>;

/**
 * The provider buttons on show (#49 C2, #828): GitHub, Discord and Google, each only when its env vars
 * are set (ADR 0009), in button order.
 */
function shownProviders(): OAuthProviderId[] {
  const enabled: readonly string[] = enabledOAuthProviders(env);
  return OAUTH_PROVIDERS.filter((p) => enabled.includes(p));
}

/**
 * The banner sentence for an Auth.js `?error=` code (#49 C4): refused by the sign-in check, an OAuth
 * account already on another file, a provider not configured; every other code (OAuthCallbackError,
 * OAuthSignin, a cancelled consent...) gets the general one. The code itself is never shown.
 */
export function oauthErrorMessage(t: Messages, code: string): string {
  const copy = t.auth.oauthError;
  if (code === "AccessDenied") return copy.denied;
  if (code === "OAuthAccountNotLinked") return copy.notLinked;
  if (code === "Configuration") return copy.unavailable;
  return copy.body;
}

/** The form labels of one screen, from the `auth` namespace (#36 C10). */
export function authFormLabels(t: Messages, mode: AuthMode): AuthFormLabels {
  const screen = mode === "sign-in" ? t.auth.signIn : t.auth.signUp;
  return {
    formName: screen.title,
    username: t.auth.fields.username,
    password: t.auth.fields.password,
    ...(mode === "sign-up"
      ? { usernameHint: t.auth.fields.usernameHint, passwordHint: t.auth.fields.passwordHint }
      : {}),
    submit: screen.submit,
    pending: screen.pending,
    errorPrefix: t.auth.errors.prefix,
  };
}

/**
 * `/sign-in` and `/sign-up` (#36 C8, bible 14.3 extension "Sign-in and sign-up"): the red kicker and the
 * Stardos H1, one sentence, then one paper docket (header row `FORM 1-A` + ink tag; the OAuth callback
 * error banner when the provider sent the visitor back; the username form; OR; GitHub, Discord and Google
 * with the age line; the link to the other screen), the guest docket and, once its page ships, the privacy
 * link (#875). No email field, no forgot-password path (R152, R153).
 */
export async function AuthScreen({
  mode,
  callbackUrl,
  oauthError = null,
}: {
  mode: AuthMode;
  callbackUrl?: string | null;
  /** The `?error=` code a failed provider sign-in came back with, or null. */
  oauthError?: string | null;
}) {
  const t = await getT();
  const screen = mode === "sign-in" ? t.auth.signIn : t.auth.signUp;
  const other = mode === "sign-in" ? AUTH_LINKS.signUp : AUTH_LINKS.signIn;
  return (
    <section className={styles.screen} aria-labelledby="auth-title">
      <div className={styles.column}>
        <div className={styles.kicker}>{screen.kicker}</div>
        <h1 id="auth-title" className={`${styles.title} ink-misregister`}>
          {screen.title}
        </h1>
        <p className={styles.lede}>{screen.lede}</p>
        <div className={styles.docket}>
          <div className={styles.docketHeader}>
            <span className={styles.docketForm}>{screen.form}</span>
            <span className={styles.tag}>{screen.tag}</span>
          </div>
          {oauthError !== null ? (
            <div className={styles.section}>
              <Alert tone="error" title={t.auth.oauthError.title}>
                {oauthErrorMessage(t, oauthError)}
              </Alert>
            </div>
          ) : null}
          <div className={styles.section}>
            <AuthForm
              mode={mode}
              labels={authFormLabels(t, mode)}
              callbackUrl={mode === "sign-in" ? callbackUrl : null}
              action={mode === "sign-in" ? signInAction : signUpAction}
            />
            {mode === "sign-in" ? (
              <p className={styles.recoverRow}>
                <span>{t.auth.signIn.recoverPrompt}</span>
                <a href={AUTH_LINKS.recover} className={styles.link}>
                  {t.auth.signIn.recoverLink}
                </a>
              </p>
            ) : null}
          </div>
          <div className={styles.section}>
            <ProviderButtons
              labels={t.auth.providers}
              providers={shownProviders()}
              callbackUrl={callbackUrl}
            />
          </div>
          <p className={styles.switch}>
            <span>{screen.switchPrompt}</span>
            <a href={other} className={styles.link}>
              {screen.switchLink}
            </a>
          </p>
        </div>
        <GuestCta labels={t.auth.guest} />
        {AUTH_LINKS.privacy ? (
          <a href={AUTH_LINKS.privacy} className={styles.privacy}>
            {t.auth.privacy}
          </a>
        ) : null}
      </div>
    </section>
  );
}
