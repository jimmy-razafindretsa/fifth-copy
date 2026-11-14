import type { ReactNode } from "react";
import type { LockerFormProps } from "./locker-form";
import { LockerForm } from "./locker-form";

/**
 * `/locker` (#943 C23, C24): the locker for a viewer, or the sign-in link state for a cookie that no
 * longer resolves (never a new guest, ADR 0009).
 */
export function LockerScreen(props: { form: LockerFormProps | null; signedOut: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col">
      {props.form ? <LockerForm {...props.form} /> : props.signedOut}
    </main>
  );
}
