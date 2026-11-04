import { Alert } from "@/components/ui";
import { getT } from "@/i18n";
import { authFormLabels } from "./auth-screen";
import { AuthFormView } from "./auth-form";
import styles from "./auth.module.css";

const EMPTY = { username: "", password: "" };

/**
 * The `/design` auth section (#36 C9): each state of the username form, rendered from props in the
 * viewer's language: default, pending (`aria-busy`, disabled submit), invalid field (`aria-invalid` and
 * its message through `aria-describedby`), server error (`role="alert"`), and the OAuth callback error
 * banner. Each specimen carries `data-auth-state` for e2e.
 */
export async function AuthStates() {
  const t = await getT();
  const signUp = authFormLabels(t, "sign-up");
  const signIn = authFormLabels(t, "sign-in");
  const e = t.auth.errors;
  const specimens = [
    {
      id: "default",
      body: (
        <AuthFormView
          mode="sign-up"
          labels={signUp}
          state={{ fieldErrors: {}, formError: null }}
          pending={false}
          values={EMPTY}
        />
      ),
    },
    {
      id: "pending",
      body: (
        <AuthFormView
          mode="sign-up"
          labels={signUp}
          state={{ fieldErrors: {}, formError: null }}
          pending
          values={{ username: "Comrade_Lynx", password: "" }}
        />
      ),
    },
    {
      id: "invalid",
      body: (
        <AuthFormView
          mode="sign-up"
          labels={signUp}
          state={{ fieldErrors: { username: e.usernameTaken }, formError: null }}
          pending={false}
          values={{ username: "comrade_lynx", password: "" }}
        />
      ),
    },
    {
      id: "server-error",
      body: (
        <AuthFormView
          mode="sign-in"
          labels={signIn}
          state={{ fieldErrors: {}, formError: e.credentials }}
          pending={false}
          values={{ username: "comrade_lynx", password: "" }}
        />
      ),
    },
    {
      id: "oauth-error",
      body: (
        <Alert tone="error" title={t.auth.oauthError.title}>
          {t.auth.oauthError.body}
        </Alert>
      ),
    },
  ];
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {specimens.map(({ id, body }) => (
        <figure key={id} data-auth-state={id} className="flex min-w-0 flex-col gap-2">
          <figcaption className="type-label text-fg">{id}</figcaption>
          <div className={`${styles.docket} ${styles.section}`}>{body}</div>
        </figure>
      ))}
    </div>
  );
}
