import { describe, expect, it } from "vitest";
import { coveredModels, missingModels, modelsFromSchema } from "./privacy-inventory";

const schema = [
  "// comment mentioning model Ghost {",
  "enum Status {",
  "  A",
  "}",
  "",
  "model User {",
  "  id String @id",
  "}",
  "",
  "model  Lobby  {",
  "  id String @id",
  "}",
  "model JobRun {",
  "  id String @id",
  "}",
].join("\n");

const inventory = (extra = "", rows: string[] = []) =>
  [
    "# Inventory",
    "",
    "| Data | Purpose | Where | Deleted by |",
    "|---|---|---|---|",
    "| Typist name | display | `prisma/schema/identity.prisma` `User.typistName` | #81 |",
    "| Guest cookie | identity | browser cookie `fc_guest` | expiry |",
    ...rows,
    "",
    extra,
  ].join("\n");

describe("modelsFromSchema", () => {
  it("lists model blocks only, ignoring enums and comments", () => {
    expect(modelsFromSchema(schema)).toEqual(["User", "Lobby", "JobRun"]);
  });
});

describe("coveredModels", () => {
  it("takes the model of every Model.field token in the Where column", () => {
    const covered = coveredModels(inventory());
    expect(covered.has("User")).toBe(true);
    expect(covered.has("Lobby")).toBe(false);
  });

  it("counts the Non-personal models list as covered", () => {
    const covered = coveredModels(
      inventory("## Non-personal models\n\n- `JobRun`: job schedule\n"),
    );
    expect(covered.has("JobRun")).toBe(true);
  });

  it("ignores a row outside any table with a Where column", () => {
    expect(coveredModels("| `Lobby.code` | x |\n").has("Lobby")).toBe(false);
  });

  it("ignores backticked tokens outside the Where column", () => {
    const md = [
      "| Data | Purpose | Where | Deleted by |",
      "|---|---|---|---|",
      "| `Lobby.code` | `Lobby` | outside the app | #143 |",
    ].join("\n");
    expect(coveredModels(md).has("Lobby")).toBe(false);
  });
});

describe("missingModels", () => {
  it("fails path: names every schema model the inventory does not cover", () => {
    const covered = coveredModels(inventory("## Non-personal models\n\n- `JobRun`\n"));
    expect(missingModels(modelsFromSchema(schema), covered)).toEqual(["Lobby"]);
  });

  it("pass path: empty when every model is listed or non-personal", () => {
    const md = inventory("## Non-personal models\n\n- `JobRun`\n", [
      "| Lobby host | hosting | `prisma/schema/lobby.prisma` `Lobby.hostUserId` | #143 |",
    ]);
    expect(missingModels(modelsFromSchema(schema), coveredModels(md))).toEqual([]);
  });

  it("never requires a planned inventory model to exist in the schema", () => {
    const md = inventory("", ["| Codes | recovery | `RecoveryCode.hash` (planned #486) | #81 |"]);
    expect(missingModels(["User"], coveredModels(md))).toEqual([]);
  });
});
