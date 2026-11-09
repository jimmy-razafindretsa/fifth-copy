import { Button } from "@/components/ui";
import { fill, type Messages } from "@/i18n";
import type { Viewer } from "@/server/auth";
import type { UploadAvatarResult } from "../../actions/upload-avatar";
import type { AvatarUser } from "../../avatars/avatar";
import { AUTH_LINKS } from "../auth-screen";
import { AvatarDialog, type AvatarDialogLabels } from "../avatar-dialog";
import styles from "./settings.module.css";

/**
 * The account section (#66 C6): a guest (or a visitor not yet on file) reads their typist name with the
 * `GUEST` tag and the way to an account; an account reads its username and the picture and data entries,
 * placeholder until the delete action (#81) lands. With `avatar` (the real screen), guests and accounts
 * both get CHANGE PICTURE, the picture dialog (#60); `/design` specimens leave it out and keep the
 * disabled button.
 */
export type AccountAvatar = {
  user: AvatarUser;
  action: (form: FormData) => Promise<UploadAvatarResult>;
  /** `?dialog=avatar` outside production (#60 C9): the dialog starts open. */
  open?: boolean;
};

function dialogLabels(t: Messages): AvatarDialogLabels {
  const avatar = t.settings.avatar;
  return {
    ...avatar.dialog,
    trigger: t.settings.account.picture,
    errorPrefix: t.settings.status.errorPrefix,
    errors: avatar.errors,
    moderation: avatar.moderation,
  };
}
export function AccountSection({
  viewer,
  t,
  idPrefix,
  avatar,
}: {
  viewer: Viewer | null;
  t: Messages;
  idPrefix: string;
  avatar?: AccountAvatar;
}) {
  const titleId = `${idPrefix}-account`;
  const soonId = `${idPrefix}-soon`;
  const a = t.settings.account;
  const account = viewer !== null && !viewer.isGuest;
  return (
    <section className={styles.section} aria-labelledby={titleId} data-setting="account">
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {t.settings.sections.account}
        </h2>
      </div>
      {viewer && (
        <dl className={styles.rows}>
          <dt>{account ? a.username : a.typist}</dt>
          <dd>
            <span className={styles.name} data-account-name>
              {account ? viewer.name : fill(t.header.honorific, { name: viewer.name })}
            </span>
            {!account && <span className={styles.tag}>{a.guestTag}</span>}
          </dd>
        </dl>
      )}
      {account ? (
        <>
          <div className={styles.actions}>
            {avatar ? (
              <AvatarDialog
                action={avatar.action}
                user={avatar.user}
                labels={dialogLabels(t)}
                initialOpen={avatar.open}
              />
            ) : (
              <Button variant="secondary" size="lg" disabled aria-describedby={soonId}>
                {a.picture}
              </Button>
            )}
            <Button variant="secondary" size="lg" disabled aria-describedby={soonId}>
              {a.deleteData}
            </Button>
          </div>
          <p id={soonId} className={styles.hint}>
            {a.soon}
          </p>
        </>
      ) : (
        <>
          {avatar && (
            <div className={styles.actions}>
              <AvatarDialog
                action={avatar.action}
                user={avatar.user}
                labels={dialogLabels(t)}
                initialOpen={avatar.open}
              />
            </div>
          )}
          <p className={styles.keep}>
            <span>{a.keep}</span>
            <a href={AUTH_LINKS.signUp} className={styles.link}>
              {a.signUp}
            </a>
          </p>
        </>
      )}
    </section>
  );
}
