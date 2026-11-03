import "dotenv/config";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { MODEL_NAMES } from "@/server/db-models";
import { featureMergeStepFiles, indexImports, loadFeatureMergeSteps } from "../testing/merge-steps";
import {
  MERGE_IGNORED_MODELS,
  MODELS_WITHOUT_USER,
  mergeSteps,
  modelsWithoutStep,
} from "./registry";

// CI has no AUTH_SECRET or RACE_TOKEN_SECRET: the feature indexes the steps load import @/env.
vi.mock("@/env", () => ({
  env: { NODE_ENV: "test", AUTH_SECRET: "m".repeat(32), RACE_TOKEN_SECRET: "r".repeat(32) },
}));

// C3 (#56): every model holding per-user data has a registered guest-merge step, or the guest's
// rows would silently cascade away when the guest row is deleted.

type Field = { name: string; kind: string; type: string };
type DataModel = { models: Record<string, { fields: Field[] }> };

// Prisma 7 dropped `Prisma.dmmf`; the generated client carries the same models and fields as its
// runtime data model. The client is never connected here.
const datamodel = (
  createPrismaClient("postgresql://unused@localhost:1/none") as unknown as {
    _runtimeDataModel: DataModel;
  }
)._runtimeDataModel;

const touchesUser = (fields: Field[]) =>
  fields.some((f) => f.name === "userId" || (f.kind === "object" && f.type === "User"));

const userModels = () =>
  Object.entries(datamodel.models)
    .filter(([, m]) => touchesUser(m.fields))
    .map(([name]) => name);

describe("guest merge coverage (C3)", () => {
  beforeAll(async () => {
    await import("./merge-guest"); // identity steps
    await loadFeatureMergeSteps();
  });

  it("reads a non-empty data model that matches Prisma.ModelName", () => {
    expect(Object.keys(datamodel.models).sort()).toEqual([...MODEL_NAMES].sort());
    expect(userModels().length).toBeGreaterThan(0);
  });

  it("has a registered step for every model with a userId field or a User relation", () => {
    const covered = new Set(mergeSteps().map((s) => s.model));
    const missing = userModels().filter(
      (m) => !MERGE_IGNORED_MODELS.includes(m) && !covered.has(m),
    );
    expect(missing, `no merge step registered for: ${missing.join(", ")}`).toEqual([]);
  });

  it("ignores only User itself", () => {
    expect(MERGE_IGNORED_MODELS).toEqual(["User"]);
  });

  it("lists exactly the models without a user relation as step-free", () => {
    const free = Object.entries(datamodel.models)
      .filter(([name, m]) => name !== "User" && !touchesUser(m.fields))
      .map(([name]) => name)
      .sort();
    expect([...MODELS_WITHOUT_USER].sort()).toEqual(free);
    expect(modelsWithoutStep(MODEL_NAMES)).toEqual([]);
  });

  it("loads every feature step file from that feature's index", () => {
    const files = featureMergeStepFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !indexImports(f))).toEqual([]);
  });
});
