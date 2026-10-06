/**
 * Fails when a Prisma model is neither in docs/privacy/inventory.md nor in its "Non-personal models" list (#71).
 *   npx tsx scripts/privacy-inventory-check.ts   (check.sh step `privacy`)
 * The model list comes from the schema files themselves (prisma/schema/*.prisma, `model X {` blocks): the
 * Prisma DMMF helper (@prisma/internals) is not installed and a regex over the schema is all this check needs.
 */
import fs from "node:fs";
import path from "node:path";
import { coveredModels, missingModels, modelsFromSchema } from "./lib/privacy-inventory";

const root = path.resolve(__dirname, "..");
const schemaDir = path.join(root, "prisma/schema");
const inventoryPath = path.join(root, "docs/privacy/inventory.md");

if (!fs.existsSync(inventoryPath)) {
  console.error("privacy-inventory: docs/privacy/inventory.md is missing");
  process.exit(1);
}
const models = fs
  .readdirSync(schemaDir)
  .filter((f) => f.endsWith(".prisma"))
  .sort()
  .flatMap((f) => modelsFromSchema(fs.readFileSync(path.join(schemaDir, f), "utf8")));
const missing = missingModels(models, coveredModels(fs.readFileSync(inventoryPath, "utf8")));

if (missing.length) {
  for (const m of missing) {
    console.error(
      `privacy-inventory: model ${m} is not in docs/privacy/inventory.md (add a row, or list it under "Non-personal models")`,
    );
  }
  process.exit(1);
}
console.log(`privacy-inventory: ok (${models.length} models)`);
