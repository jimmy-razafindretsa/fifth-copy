import type { Metadata } from "next";
import { Alert, Button, Card, EmptyState, Field, Skeleton, Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Design system" };

/** Living inventory of src/components/ui (see docs/design/components.md). Used by e2e + visual tests. */
export default function DesignPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-8">
      <h1 className="text-3xl font-semibold text-fg">Design system</h1>

      <section aria-labelledby="buttons" className="flex flex-col gap-3">
        <h2 id="buttons" className="text-xl font-medium">
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
        <h2 id="fields" className="text-xl font-medium">
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
        <h2 id="states" className="text-xl font-medium">
          States
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="mb-3 font-medium">Loading</h3>
            <div aria-busy="true" aria-label="Loading items" className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Spinner />
            </div>
          </Card>
          <Card>
            <h3 className="mb-3 font-medium">Empty</h3>
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
