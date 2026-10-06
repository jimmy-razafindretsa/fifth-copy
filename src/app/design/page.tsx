import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Alert, Button, Card, EmptyState, Field, Skeleton, Spinner } from "@/components/ui";

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
      <dd className="min-w-0 break-words">{children}</dd>
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

/** Living inventory of src/components/ui (see docs/design/components.md). Used by e2e + visual tests. */
export default function DesignPage() {
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
            <p data-type-role="display-lg" className="type-display-lg">
              HERO OF PAPERWORK
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
    </main>
  );
}
