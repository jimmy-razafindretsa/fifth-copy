/** Lowest free desk number >= 1 given the desks already taken (duplicates and gaps allowed). */
export function nextDesk(taken: number[]): number {
  const used = new Set(taken);
  let desk = 1;
  while (used.has(desk)) desk += 1;
  return desk;
}
