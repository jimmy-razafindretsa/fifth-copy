import { fill, getT } from "@/i18n";
import styles from "./auth.module.css";
import { ResetFormView } from "./reset-form";
import { resetFormLabels } from "./reset-screen";

const EMPTY = { username: "", code: "", password: "" };
const TYPED = { username: "comrade_lynx", code: "", password: "" };

/**
 * The `/design` reset states (#789 C5): default, pending (`aria-busy`, disabled submit), field error
 * (`aria-invalid` + `aria-describedby`), generic error (`role="alert"`, never the code), rate-limited
 * and success (the alert row with the `/sign-in` link), from props in the viewer's language. Each
 * specimen carries `data-reset-state` for e2e.
 */
export async function ResetStates() {
  const t = await getT();
  const labels = resetFormLabels(t);
  const e = t.auth.reset.errors;
  const idle = { status: "idle", fieldErrors: {}, formError: null } as const;
  const specimens = [
    { id: "default", state: idle, pending: false, values: EMPTY },
    { id: "pending", state: idle, pending: true, values: TYPED },
    {
      id: "field-error",
      state: { status: "fields", fieldErrors: { code: e.codeFormat }, formError: null },
      pending: false,
      values: TYPED,
    },
    {
      id: "generic-error",
      state: { status: "invalid", fieldErrors: {}, formError: e.invalid },
      pending: false,
      values: TYPED,
    },
    {
      id: "rate-limited",
      state: {
        status: "rate-limited",
        fieldErrors: {},
        formError: fill(e["rate-limited"], { m: 42 }),
      },
      pending: false,
      values: TYPED,
    },
    {
      id: "success",
      state: { status: "done", fieldErrors: {}, formError: null },
      pending: false,
      values: EMPTY,
    },
  ] as const;
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {specimens.map(({ id, state, pending, values }) => (
        <figure key={id} data-reset-state={id} className="flex min-w-0 flex-col gap-2">
          <figcaption className="type-label text-fg">reset · {id}</figcaption>
          <div className={`${styles.docket} ${styles.section}`}>
            <ResetFormView
              labels={labels}
              state={{ ...state, fieldErrors: { ...state.fieldErrors } }}
              pending={pending}
              values={values}
            />
          </div>
        </figure>
      ))}
    </div>
  );
}
