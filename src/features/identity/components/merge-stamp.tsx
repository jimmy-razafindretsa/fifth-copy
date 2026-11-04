import "server-only";
import { cookies } from "next/headers";
import { fill, getT } from "@/i18n";
import { MERGED_COOKIE, mergePluralForm, parseMergedFlash } from "../merge/flash-cookie";
import { MergeStampDocket } from "./merge-stamp-docket";

/**
 * The merge confirmation (#57, design bible 7.3 ink tone, 7.4): mounted once in the root layout, it reads
 * the one-shot `fc_merged` cookie a merge caller left (`flashMerge`) and renders the stamp docket, which
 * clears the cookie in the browser. No cookie, or a forged one, renders nothing.
 */
export async function MergeStamp() {
  const races = parseMergedFlash((await cookies()).get(MERGED_COOKIE)?.value);
  if (races === null) return null;
  const m = (await getT()).auth.merge;
  const form = mergePluralForm(races);
  return (
    <MergeStampDocket
      races={races}
      title={m.stamp}
      carried={fill(m.carried[form], { n: races })}
      sentence={fill(m.sentence[form], { n: races })}
      dismiss={m.dismiss}
    />
  );
}
