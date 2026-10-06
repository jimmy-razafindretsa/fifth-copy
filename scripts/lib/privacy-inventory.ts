/**
 * Pure helpers for scripts/privacy-inventory-check.ts (card #71): every Prisma model must be covered by
 * docs/privacy/inventory.md, either through a `Model.field` token in the "Where" column of a table or by
 * the "## Non-personal models" list. No IO here; the script reads the files.
 */

const MODEL_BLOCK = /^model\s+(\w+)\s*\{/gm;
const MODEL_TOKEN = /`([A-Z]\w*)(?:\.\w+)?`/g;
const NON_PERSONAL_HEADING = /^##\s+Non-personal models\s*$/i;

/** Model names declared in a .prisma file's text, in order. Enums, types and comments are ignored. */
export function modelsFromSchema(text: string): string[] {
  return [...text.matchAll(MODEL_BLOCK)].map((m) => m[1]);
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function tokens(text: string): string[] {
  return [...text.matchAll(MODEL_TOKEN)].map((m) => m[1]);
}

/**
 * Models the inventory covers: the model part of each backticked `Model` or `Model.field` token in the
 * "Where" column of any table whose header has that column, plus every backticked name listed under
 * "## Non-personal models".
 */
export function coveredModels(inventoryMd: string): Set<string> {
  const covered = new Set<string>();
  let whereCol = -1;
  let inNonPersonal = false;
  for (const line of inventoryMd.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      inNonPersonal = NON_PERSONAL_HEADING.test(line);
      whereCol = -1;
      continue;
    }
    if (inNonPersonal) {
      for (const t of tokens(line)) covered.add(t);
      continue;
    }
    if (!line.trim().startsWith("|")) {
      whereCol = -1;
      continue;
    }
    const row = cells(line);
    if (whereCol === -1) {
      whereCol = row.findIndex((c) => /^\s*Where\b/i.test(c));
      continue;
    }
    if (/^\s*:?-{3,}/.test(row[0] ?? "")) continue;
    for (const t of tokens(row[whereCol] ?? "")) covered.add(t);
  }
  return covered;
}

/** Schema models the inventory does not cover. Inventory entries for planned models are never required. */
export function missingModels(schemaModels: string[], covered: Set<string>): string[] {
  return schemaModels.filter((m) => !covered.has(m));
}
