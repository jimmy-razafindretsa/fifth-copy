import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { keyEventFixtureSchema, type KeyEventFixture } from "./fixture";

/** The fixture folder (#1001 C2). */
export const FIXTURE_DIR = path.join(process.cwd(), "src/features/race/client/input/fixtures");

/** Every fixture file, parsed (tests only: reads the disk). */
export function loadFixtures(): { file: string; fixture: KeyEventFixture }[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      fixture: keyEventFixtureSchema.parse(
        JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")),
      ),
    }));
}
