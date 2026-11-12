import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Test support (#56): every feature registers its guest-merge steps in
// src/features/<feature>/merge-step(s).ts, imported for its side effect by that feature's index.ts.
// Tests load them by path, like the app does through each index.

const FEATURES = path.resolve(__dirname, "../..");
const FILE = /^merge-steps?\.ts$/;

/** Feature step files, relative to src/features, e.g. `lobby/merge-step.ts`. */
export function featureMergeStepFiles(): string[] {
  return readdirSync(FEATURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(FEATURES, d.name))
        .filter((f) => FILE.test(f))
        .map((f) => `${d.name}/${f}`),
    );
}

/** True when the feature's index.ts imports the step file for its side effect. */
export function indexImports(file: string): boolean {
  const [feature, name] = file.split("/");
  const index = path.join(FEATURES, feature!, "index.ts");
  if (!existsSync(index)) return false;
  const spec = `./${name!.replace(/\.ts$/, "")}`;
  return readFileSync(index, "utf8").includes(`import "${spec}";`);
}

/** Imports every feature step file, so the registry holds what the running app registers. */
export async function loadFeatureMergeSteps(): Promise<void> {
  for (const file of featureMergeStepFiles()) {
    await import(/* @vite-ignore */ path.join(FEATURES, file));
  }
}
