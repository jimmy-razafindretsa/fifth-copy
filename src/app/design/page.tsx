import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import {
  Alert,
  Band,
  Button,
  Card,
  Device,
  EmptyState,
  Field,
  MotionSafe,
  Skeleton,
  Monogram,
  type MonogramVariant,
  Spinner,
  Stamp,
  Star,
  Wordmark,
} from "@/components/ui";
import { getTheme, ThemeToggle } from "@/features/preferences";
import {
  TelexStrip,
  TypedSheet,
  type TypedViewFixture,
  typedViewFixtures,
  TypingMachine,
  type TypingMachineProps,
} from "@/features/race";
import { getT } from "@/i18n";
import demo from "./motion-demo.module.css";
import { StampReplay } from "./stamp-demo";

export const metadata: Metadata = { title: "Design system" };

// Literal class strings: Tailwind 4 only emits utilities it finds as complete strings.
const ROLES = [
  ["bg", "bg-bg"],
  ["surface", "bg-surface"],
  ["surface-muted", "bg-surface-muted"],
  ["fg", "bg-fg"],
  ["fg-muted", "bg-fg-muted"],
  ["border", "bg-border"],
  ["primary", "bg-primary"],
  ["primary-hover", "bg-primary-hover"],
  ["primary-fg", "bg-primary-fg"],
  ["pressed", "bg-pressed"],
  ["danger", "bg-danger"],
  ["danger-surface", "bg-danger-surface"],
  ["success", "bg-success"],
  ["success-surface", "bg-success-surface"],
  ["focus", "bg-focus"],
  ["link", "bg-link"],
  ["you", "bg-you"],
  ["rival", "bg-rival"],
  ["reward", "bg-reward"],
  ["untyped", "bg-untyped"],
  ["room", "bg-room"],
  ["tape", "bg-tape"],
  ["typing-done", "bg-typing-done"],
  ["typing-next", "bg-typing-next"],
  ["typing-next-bg", "bg-typing-next-bg"],
  ["typing-remaining", "bg-typing-remaining"],
  ["typing-error", "bg-typing-error"],
  ["device-phosphor", "bg-device-phosphor"],
  ["device-nixie", "bg-device-nixie"],
  ["device-bezel", "bg-device-bezel"],
  ["sheet", "bg-sheet"],
  ["machine-paper", "bg-machine-paper"],
  ["machine-deck", "bg-machine-deck"],
  ["machine-ink", "bg-machine-ink"],
  ["machine-metal", "bg-machine-metal"],
  ["machine-muted", "bg-machine-muted"],
] as const;

// Type roles (#20): art-direction 7 samples, literal strings (ADR 0010, until #372). The two Cyrillic
// lines are explicitly dual in-world stamps (bible 0); their Cyrillic falls to Oswald (tokens.css).
const MAJOR =
  "At dawn, the Major pins a medal on the fastest typist. The slowest is sent to sort files in the basement.";

function TypeRole({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <dt>
        <code className="font-typing text-sm text-fg-muted">{name}</code>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Swatch({ role, chip }: { role: string; chip: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={`h-8 w-8 shrink-0 rounded-sm border border-border ${chip}`} />
      <code data-role={role} className="font-typing text-sm text-fg">
        {role}
      </code>
    </li>
  );
}

// Each wordmark on the ground its variant names (docs/design/logo.md): paper, red, ink, in both themes.
const PLATES = [
  { ground: "paper", plate: "bg-band-fg", variant: "red-on-paper", label: "Red on paper" },
  { ground: "red", plate: "bg-primary", variant: "ink-on-red", label: "Ink on red" },
  { ground: "ink", plate: "bg-band", variant: "red-on-ink", label: "Red on ink" },
] as const;
const TILES: MonogramVariant[] = ["paper", "red", "ink"];
const LADDER = [16, 32, 64] as const;

function Plate({
  ground,
  plate,
  children,
}: {
  ground: string;
  plate: string;
  children: ReactNode;
}) {
  return (
    <div
      data-plate={ground}
      className={`flex items-center justify-center overflow-hidden border-2 border-fg ${plate}`}
    >
      {children}
    </div>
  );
}

/** One printed-motif demo (#25): a `data-motif` hook for e2e, a caption naming where the bible allows it. */
function Motif({
  name,
  caption,
  children,
}: {
  name: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure data-motif={name} className="flex min-w-0 flex-col gap-2">
      {children}
      <figcaption className="text-sm text-fg-muted">{caption}</figcaption>
    </figure>
  );
}

// Typing surface (#558, bible 7.7, 7.7a): a QWERTY teleprinter for the specimens only; the real layouts
// arrive as data with #224. Each state names its fixture and the machine props it shows.
const QWERTY = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
];

type TypingState = {
  id: string;
  title: string;
  caption: string;
  view: TypedViewFixture;
  machine: Pick<TypingMachineProps, "pressed" | "wrong" | "disabledKeys">;
  reduce?: boolean;
};

const TYPING_STATES: TypingState[] = [
  {
    id: "before-start",
    title: "Before the start",
    caption: "The caret waits on the first letter; nothing typed yet.",
    view: "before-start",
    machine: {},
  },
  {
    id: "racing",
    title: "Racing",
    caption:
      "Typed text in ink, the next letter in the red cell, the rest in violet. The key is down.",
    view: "racing",
    machine: { pressed: "m" },
  },
  {
    id: "continue-wrong",
    title: "Continue mode, wrong",
    caption: "Slips stay red on the tape and struck through on the sheet; the wrong key reads red.",
    view: "continue-wrong",
    machine: { wrong: "b" },
  },
  {
    id: "block-jammed",
    title: "Block mode, jammed",
    caption:
      "The cursor holds on the letter. The machine jams: key outlines, the space bar and the slot read red, with a red X at the printing point.",
    view: "block-jammed",
    machine: { wrong: "a" },
  },
  {
    id: "finished",
    title: "Finished",
    caption: "The whole copy on the sheet. Keys that do nothing show a dashed outline.",
    view: "finished",
    machine: { disabledKeys: [...QWERTY.flat(), " "] },
  },
  {
    id: "reduced-motion",
    title: "Reduced motion",
    caption: "A solid red cell, no pop, and the tape jumps instead of gliding.",
    view: "racing",
    machine: { pressed: "m" },
    reduce: true,
  },
];

/** One typing-surface state on its paper backdrop: strip on top, the sheet rising out of the machine. */
function TypingSpecimen({ state }: { state: TypingState }) {
  const view = typedViewFixtures[state.view];
  return (
    <figure
      data-typing-state={state.id}
      data-motion={state.reduce ? "reduce" : undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <figcaption className="flex flex-col gap-1">
        <span className="type-label text-fg">{state.title}</span>
        <span className="type-body text-sm text-fg-muted">{state.caption}</span>
      </figcaption>
      <div className="flex flex-col gap-6 border-2 border-fg bg-band-fg p-4 md:p-6">
        <TelexStrip view={view} labels={{ strip: `Text to type, ${state.title.toLowerCase()}` }} />
        <div className="mx-auto w-full max-w-[620px]">
          {/* bible 7.7a: the sheet (61% of the machine) rises out of the slot; the machine, later in the
              DOM, paints over its bottom 22 machine units (3.55% of the machine's width) */}
          <div className="mx-auto -mb-[3.55%] w-[61.3%]">
            <TypedSheet view={view} />
          </div>
          <TypingMachine rows={QWERTY} jammed={view.jammed} {...state.machine} />
        </div>
      </div>
    </figure>
  );
}

/** Living inventory of src/components/ui (see docs/design/components.md). Used by e2e + visual tests. */
export default async function DesignPage() {
  const [t, theme] = await Promise.all([getT(), getTheme()]);
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-8">
      <header className="flex flex-col gap-3">
        <h1 className="type-display-lg text-fg">Design system</h1>
        <p data-intro className="type-body max-w-prose text-fg">
          The living inventory of the colour roles, the type roles and the primitives. Every screen
          is built from these parts.
        </p>
      </header>

      <section aria-labelledby="colour-roles" className="flex flex-col gap-3">
        <h2 id="colour-roles" className="type-display-md">
          Colour roles
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {ROLES.map(([role, chip]) => (
            <Swatch key={role} role={role} chip={chip} />
          ))}
        </ul>
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex flex-col gap-2">
            <p
              data-sample="typing"
              className="type-typing rounded-md border border-border bg-tape px-4 py-3"
            >
              <span className="text-typing-done">Type fast. T</span>
              <span className="text-typing-error">u</span>
              <span className="bg-typing-next-bg text-typing-next">p</span>
              <span className="text-typing-remaining">e first.</span>
            </p>
            <figcaption className="text-sm text-fg-muted">
              Typing strip: done, error, next, remaining
            </figcaption>
          </figure>
          <figure className="flex flex-col gap-2">
            <p
              data-sample="device"
              className="type-device flex gap-6 rounded-md bg-device-bezel px-4 py-3 text-2xl"
            >
              <span className="text-device-phosphor">0412</span>
              <span className="text-device-nixie">88:21</span>
            </p>
            <figcaption className="text-sm text-fg-muted">Device: phosphor and nixie</figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="type-roles" className="flex flex-col gap-3">
        <h2 id="type-roles" className="type-display-md">
          Type roles
        </h2>
        <dl className="flex flex-col gap-4">
          <TypeRole name="type-display-lg">
            {/* PAPERWORK at 3.5rem is wider than a 375px phone: a soft hyphen breaks it there only */}
            <p data-type-role="display-lg" className="type-display-lg">
              HERO OF PAPER{"\u00AD"}WORK
            </p>
          </TypeRole>
          <TypeRole name="type-display-md">
            <p data-type-role="display-md" className="type-display-md">
              HERO OF PAPERWORK
            </p>
          </TypeRole>
          <TypeRole name="type-display-sm">
            <p data-type-role="display-sm" className="type-display-sm">
              HERO OF PAPERWORK
            </p>
          </TypeRole>
          <TypeRole name="type-display-md (Cyrillic)">
            <p data-type-cyrillic="display" className="type-display-md">
              <span lang="ru">НАЧАЛИ</span> / GO
            </p>
          </TypeRole>
          <TypeRole name="type-label">
            <p data-type-role="label" className="type-label">
              DOCKET
            </p>
          </TypeRole>
          <TypeRole name="type-label (Cyrillic)">
            <p data-type-cyrillic="label" className="type-label">
              <span lang="ru">ОБОГНАЛИ</span> · PASSED
            </p>
          </TypeRole>
          <TypeRole name="type-typing">
            <p
              lang="fr"
              data-type-role="typing"
              className="type-typing rounded-md border border-border bg-tape px-4 py-3 text-typing-done"
            >
              « Où est le café ? » Déjà 4 h 30 ; dépêche-toi !
            </p>
          </TypeRole>
          <TypeRole name="type-flavour">
            <p data-type-role="flavour" className="type-flavour text-lg">
              ASSET NIGHTINGALE MEETS AT 0400.
            </p>
          </TypeRole>
          <TypeRole name="type-body">
            <p data-type-role="body" className="type-body max-w-prose">
              {MAJOR}
            </p>
          </TypeRole>
          <TypeRole name="type-device">
            <p className="inline-flex rounded-md bg-device-bezel px-4 py-3">
              <span data-type-role="device" className="type-device text-2xl text-device-phosphor">
                00 88 66
              </span>
            </p>
          </TypeRole>
        </dl>
      </section>

      <section aria-labelledby="brand" className="flex flex-col gap-3">
        <h2 id="brand" className="type-display-md">
          Brand
        </h2>
        <p className="type-body max-w-prose text-fg">
          The wordmark and the FC monogram, drawn from the brand files. Each wordmark sits on the
          ground its variant names; the monogram carries its own tile. Rules: the logo guide.
        </p>
        <ul data-brand-demo="wordmarks" className="grid gap-4 md:grid-cols-3">
          {PLATES.map(({ ground, plate, variant, label }) => (
            <li key={ground}>
              <figure className="flex flex-col gap-2">
                <Plate ground={ground} plate={plate}>
                  <Wordmark
                    variant={variant}
                    title={`Fifth Copy wordmark, ${label.toLowerCase()}`}
                    width={220}
                  />
                </Plate>
                <figcaption className="text-sm text-fg-muted">{label}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 md:grid-cols-2">
          <figure data-brand-demo="tagline" className="flex flex-col gap-2">
            <Plate ground="paper" plate="bg-band-fg">
              <Wordmark
                variant="red-on-paper"
                tagline
                title="Fifth Copy, type fast, type first"
                width={330}
              />
            </Plate>
            <figcaption className="text-sm text-fg-muted">
              With the tagline, only from 240 px wide
            </figcaption>
          </figure>
          <figure data-brand-demo="clear-space" className="flex flex-col gap-2">
            <Plate ground="paper" plate="bg-band-fg">
              <Wordmark
                variant="red-on-paper"
                title="Fifth Copy wordmark with its clear space"
                width={260}
                className="outline-2 -outline-offset-2 outline-band outline-dashed"
              />
            </Plate>
            <figcaption className="text-sm text-fg-muted">
              Clear space: one bar height on every side
            </figcaption>
          </figure>
        </div>
        <ul data-brand-demo="monograms" className="flex flex-wrap gap-6">
          {TILES.map((tile) => (
            <li key={tile}>
              <figure className="flex flex-col gap-2">
                <div className="flex items-end gap-3">
                  {LADDER.map((size) => (
                    <Monogram
                      key={size}
                      variant={tile}
                      size={size}
                      clearSpace={false}
                      title={`FC monogram, ${tile} tile, ${size} px`}
                    />
                  ))}
                </div>
                <figcaption className="text-sm text-fg-muted">Monogram, {tile} tile</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="printed-motifs" className="flex flex-col gap-3">
        <h2 id="printed-motifs" className="type-display-md">
          Printed motifs
        </h2>
        <p className="type-body max-w-prose text-fg">
          Ink on paper: halftone, misregistration, steep bands and stars. Textures are opt-in and
          step aside under high contrast; glow lives only inside a device.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Motif name="paper-grain" caption="paper-grain: halftone dots on the hero ground">
            <div
              data-plate="paper-grain"
              className="paper-grain flex h-32 items-end border-2 border-fg bg-bg p-4"
            >
              <p className="type-label">Hero ground</p>
            </div>
          </Motif>
          <Motif
            name="paper-grain-red"
            caption="paper-grain-red: red halftone on the final-call band"
          >
            <div
              data-plate="paper-grain-red"
              className="paper-grain-red flex h-32 items-end border-2 border-fg bg-primary p-4 text-primary-fg"
            >
              <p className="type-label">Final call</p>
            </div>
          </Motif>
          <Motif name="misregister" caption="ink-misregister on a type-display title">
            <p className="type-display-lg ink-misregister text-fg">FIFTH COPY</p>
          </Motif>
          <Motif name="band" caption="Band at 38 degrees with an upright label">
            <Band upright className="h-40 border-2 border-fg bg-bg">
              <span className="type-label text-primary-fg">Room 457 · 30 seats</span>
            </Band>
          </Motif>
          <Motif name="stars" caption="Two Stars: red and a big faint one, never over text">
            <div className="relative h-40 overflow-hidden border-2 border-fg bg-surface">
              <Star size={56} tone="red" spin={40} at={{ top: 20, left: 24 }} />
              <Star size={160} tone="faintInk" spin={90} at={{ bottom: -40, right: -20 }} />
            </div>
          </Motif>
          <Motif name="sun-rays" caption="sun-rays: a character-stage ground only">
            <div
              data-plate="sun-rays"
              className="sun-rays flex h-40 items-end justify-center border-2 border-fg bg-bg p-4"
            >
              <p className="type-label">Character stage</p>
            </div>
          </Motif>
          <Motif
            name="device"
            caption="Device: nixie numerals and a phosphor CRT word, the only glow"
          >
            <div className="flex flex-wrap items-center gap-4">
              <Device tone="nixie">
                <span className="type-device text-3xl">00 88 66</span>
              </Device>
              <Device tone="phosphor">
                <span className="type-label">READY</span>
              </Device>
            </div>
          </Motif>
          <Motif name="device-outside" caption="The same glow class outside a Device sets nothing">
            <p className="type-label text-fg">
              <span className="device-phosphor">READY</span> outside a device
            </p>
          </Motif>
        </div>
      </section>

      <section aria-labelledby="buttons" className="flex flex-col gap-3">
        <h2 id="buttons" className="type-display-md">
          Buttons
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Saving</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section aria-labelledby="fields" className="flex flex-col gap-3">
        <h2 id="fields" className="type-display-md">
          Fields
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Email"
            type="email"
            placeholder="you@example.com"
            hint="We never share it."
          />
          <Field
            label="Name"
            required
            defaultValue="A"
            error="Name must be at least 2 characters."
          />
        </div>
      </section>

      <section aria-labelledby="states" className="flex flex-col gap-3">
        <h2 id="states" className="type-display-md">
          States
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="type-label mb-3">Loading</h3>
            <div aria-busy="true" aria-label="Loading items" className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Spinner />
            </div>
          </Card>
          <Card>
            <h3 className="type-label mb-3">Empty</h3>
            <EmptyState
              title="No items yet"
              description="Items you create appear here."
              action={<Button size="sm">Create item</Button>}
            />
          </Card>
          <Alert tone="error" title="Could not save">
            Check your connection and try again.
          </Alert>
          <Alert tone="success" title="Saved" />
          <Alert title="Heads up">Informational message.</Alert>
        </div>
      </section>

      <section aria-labelledby="stamps" className="flex flex-col gap-3">
        <h2 id="stamps" className="type-display-md">
          Stamps
        </h2>
        <p className="type-body max-w-prose text-fg">
          A rubber stamp slams in once, crooked, in red or ink. Under reduced motion it is simply
          there.
        </p>
        {/* the slam starts at 2.2x: clip it to the specimen so it never scrolls the page sideways */}
        <div className="flex flex-wrap items-center gap-8 overflow-x-clip p-4">
          <Stamp
            lines={[
              // RSC checks keys on element arrays passed as props
              <Fragment key="go">
                <span lang="ru">НАЧАЛИ</span> / GO
              </Fragment>,
            ]}
          />
          <Stamp
            tone="ink"
            size="sm"
            rotation="auto"
            seed="passed"
            lines={[
              <Fragment key="passed">
                <span lang="ru">ОБОГНАЛИ</span> · PASSED
              </Fragment>,
            ]}
          />
          <StampReplay />
        </div>
      </section>

      <section aria-labelledby="preferences" className="flex flex-col gap-3">
        <h2 id="preferences" className="type-display-md">
          Preferences
        </h2>
        <p className="type-body max-w-prose text-fg">
          The NIGHT SHIFT toggle of the header: the gold dot lights on the night ground. The choice
          lives in the theme cookie; without it the page follows the system.
        </p>
        <div data-preferences-demo className="flex flex-wrap items-center gap-3">
          <ThemeToggle theme={theme} label={t.header.nightShift} />
        </div>
      </section>

      <section aria-labelledby="motion" className="flex flex-col gap-3">
        <h2 id="motion" className="type-display-md">
          Motion
        </h2>
        <p className="type-body max-w-prose text-fg">
          Durations come from the motion tokens. Under reduced motion, from the system or from
          data-motion on the page, they drop to zero and the box stands still.
        </p>
        <div className="flex flex-wrap items-center gap-6">
          <span
            aria-hidden
            data-motion-demo
            className={`inline-block size-12 rounded-sm border-2 border-fg bg-surface ${demo.pulse}`}
          />
          <p data-motion-safe className="type-label">
            <MotionSafe fallback="Motion reduced">Motion on</MotionSafe>
          </p>
        </div>
      </section>

      <section id="race-typing" aria-labelledby="typing-surface" className="flex flex-col gap-3">
        <h2 id="typing-surface" className="type-display-md">
          Typing surface
        </h2>
        <p className="type-body max-w-prose text-fg">
          The seat view&apos;s telex strip, then the typed sheet rising out of the compact
          teleprinter, in each race state. They are objects, the same in both themes, on a paper
          backdrop.
        </p>
        <div className="flex flex-col gap-10">
          {TYPING_STATES.map((state) => (
            <TypingSpecimen key={state.id} state={state} />
          ))}
        </div>
      </section>
    </main>
  );
}
