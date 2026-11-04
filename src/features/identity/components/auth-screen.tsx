import { Alert } from "@/components/ui";
import { getT } from "@/i18n";
import { signInAction } from "../actions/sign-in";
import { signUpAction } from "../actions/sign-up";
import { AuthForm, type AuthFormLabels } from "./auth-form";
import styles from "./auth.module.css";
import { GuestCta } from "./guest-cta";
import { ProviderButtons } from "./provider-buttons";

export type AuthMode = "sign-in" | "sign-up";

/** The routes of the two screens and the privacy page (ARCHITECTURE 8.1; `/privacy` is post-v1). */
export const AUTH_LINKS = { signIn: "/sign-in", signUp: "/sign-up", privacy: "/privacy" } as const;

type Messages = Awaited<ReturnType<typeof getT>>;

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
 * with the age line; the link to the other screen), the guest docket and the privacy link. No email field,
 * no forgot-password path (R152, R153).
 */
export async function AuthScreen({
  mode,
  callbackUrl,
  oauthError = false,
}: {
  mode: AuthMode;
  callbackUrl?: string | null;
  oauthError?: boolean;
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
          {oauthError ? (
            <div className={styles.section}>
              <Alert tone="error" title={t.auth.oauthError.title}>
                {t.auth.oauthError.body}
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
          </div>
          <div className={styles.section}>
            <ProviderButtons labels={t.auth.providers} callbackUrl={callbackUrl} />
          </div>
          <p className={styles.switch}>
            <span>{screen.switchPrompt}</span>
            <a href={other} className={styles.link}>
              {screen.switchLink}
            </a>
          </p>
        </div>
        <GuestCta labels={t.auth.guest} />
        <a href={AUTH_LINKS.privacy} className={styles.privacy}>
          {t.auth.privacy}
        </a>
      </div>
    </section>
  );
}
