import { Alert } from "@/components/ui";
import { fill, getT } from "@/i18n";
import styles from "./auth.module.css";
import { RecoverFormView } from "./recover-form";
import { recoverFormLabels, recoveryCardLabels } from "./recover-screen";
import { RecoveryCard } from "./recovery-card";

const EMPTY = { username: "", code: "", password: "" };
const TYPED = { username: "comrade_lynx", code: "", password: "" };
/** Specimen words (not a real code: nobody's hash). */
const SPECIMEN = [
  "acorn",
  "lanterne",
  "harbor",
  "écureuil",
  "violin",
  "brioche",
  "comet",
  "tulipe",
  "kettle",
  "phare",
];

/**
 * The `/design` recovery states (#46): the reveal card, the reveal once shown (`ALREADY SHOWN`), and
 * the `/recover` form in default, pending, field error, the one generic answer, rate-limited and
 * success (the new code revealed). Each specimen carries `data-recovery-state` for e2e.
 */
export async function RecoverStates() {
  const t = await getT();
  const labels = recoverFormLabels(t);
  const e = t.auth.recovery.errors;
  const gone = t.auth.recovery.reveal.gone;
  const idle = { status: "idle", fieldErrors: {}, formError: null } as const;
  const forms = [
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
      state: { status: "done", fieldErrors: {}, formError: null, words: SPECIMEN },
      pending: false,
      values: EMPTY,
    },
  ] as const;
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      <figure data-recovery-state="reveal" className="flex min-w-0 flex-col gap-2">
        <figcaption className="type-label text-fg">recovery · reveal</figcaption>
        <div className={styles.docket}>
          <RecoveryCard words={SPECIMEN} labels={recoveryCardLabels(t)} href="#auth" />
        </div>
      </figure>
      <figure data-recovery-state="already-shown" className="flex min-w-0 flex-col gap-2">
        <figcaption className="type-label text-fg">recovery · already shown</figcaption>
        <div className={`${styles.docket} ${styles.section}`}>
          <Alert title={gone.title}>
            <p>{gone.body}</p>
          </Alert>
        </div>
      </figure>
      {forms.map(({ id, state, pending, values }) => (
        <figure key={id} data-recovery-state={id} className="flex min-w-0 flex-col gap-2">
          <figcaption className="type-label text-fg">recover · {id}</figcaption>
          <div className={`${styles.docket} ${styles.section}`}>
            <RecoverFormView
              labels={labels}
              state={{
                ...state,
                fieldErrors: { ...state.fieldErrors },
                ...("words" in state ? { words: [...state.words] } : {}),
              }}
              pending={pending}
              values={values}
            />
          </div>
        </figure>
      ))}
    </div>
  );
}
