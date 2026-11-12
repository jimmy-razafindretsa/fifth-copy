import { DefaultPortrait, LayoutPrompt, portraitVariant } from "@/features/identity";
import type { Messages } from "@/i18n";
import { fileSpecimenPreference } from "./settings-demo-action";

const SIZES = [32, 64, 128] as const;

/** The first seed of `specimen-<n>` that lands on each of the four variants. */
function variantSeeds(): string[] {
  const seeds: string[] = [];
  for (let n = 0; seeds.length < 4 && n < 200; n++) {
    const seed = `specimen-${n}`;
    if (seeds[portraitVariant(seed)] === undefined) seeds[portraitVariant(seed)] = seed;
  }
  return seeds;
}

/**
 * The `/design` avatar section (#60 C8): the stamped portrait's four variants at 32, 64 and 128 px on
 * the paper ground and on the newsprint panel, each named by a specimen typist.
 */
export function AvatarSpecimens() {
  const seeds = variantSeeds();
  return (
    <div className="flex flex-col gap-4">
      {(["bg-bg", "bg-surface"] as const).map((ground) => (
        <div
          key={ground}
          data-avatar-ground={ground}
          className={`${ground} flex flex-wrap items-end gap-6 border-2 border-fg p-4`}
        >
          {seeds.map((seed, variant) => (
            <figure key={seed} className="m-0 flex flex-col items-start gap-2">
              <div className="flex items-end gap-3">
                {SIZES.map((size) => (
                  <DefaultPortrait
                    key={size}
                    seed={seed}
                    size={size}
                    label={`Specimen ${variant + 1}, ${size} px`}
                  />
                ))}
              </div>
              <figcaption className="type-label text-xs text-fg">VARIANT {variant + 1}</figcaption>
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
}

/** `/design?dialog=layout` (#70 C3): the keyboard prompt open over the gallery, saving nothing. */
export function DesignDialogs({ dialog, t }: { dialog: string | undefined; t: Messages }) {
  if (dialog !== "layout") return null;
  return (
    <LayoutPrompt
      action={fileSpecimenPreference}
      labels={t.settings.layoutPrompt}
      names={t.settings.layout.names}
      status={t.settings.status}
      alwaysOpen
    />
  );
}
