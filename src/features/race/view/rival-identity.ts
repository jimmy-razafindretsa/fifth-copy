import { DESK_COLORS, deskIdentity, type Marker, type Member } from "@fifth-copy/protocol";

/**
 * A desk's identity on the race card and in the room (#565, spec 6.2, R80, design bible 3.1): the muted
 * rival ink and marker shape the desk allocator gave it (`Member.color`, `Member.marker`, #156/#557), and
 * its desk number. Pure: it maps indices to colour role names (never values) and passes the shape through.
 * The viewer is always `you` (agit-red, bible 0). Extension point: #267 reads it for placards and scarves.
 */

type RivalIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
/** One of the twelve rival inks, a colour role (`--color-rival-N`, docs/design/tokens.css). */
export type RivalInk = `rival-${RivalIndex}`;
// Compile-time guard: the protocol's colour count is the inks' count.
const _twelve: typeof DESK_COLORS extends 12 ? true : never = true;
void _twelve;

/** The inks in allocator order: `RIVAL_INKS[member.color]`. */
export const RIVAL_INKS = Array.from(
  { length: DESK_COLORS },
  (_, i) => `rival-${i}` as RivalInk,
) as readonly RivalInk[];

/** A marker's ink: a rival's own, or `you` for the viewer. */
export type IdentityInk = RivalInk | "you";

export type RivalIdentity = { colour: IdentityInk; shape: Marker; desk: number };

/** The identity of `member`; `you` is the viewer's desk (null for a spectator). */
export function rivalIdentity(
  member: Pick<Member, "desk" | "color" | "marker">,
  you: number | null,
): RivalIdentity {
  return {
    colour: member.desk === you ? "you" : (RIVAL_INKS[member.color] ?? RIVAL_INKS[0]!),
    shape: member.marker,
    desk: member.desk,
  };
}

/** The identity of `desk` from the roster, or from `deskIdentity` (the same values) when it is missing. */
export function identityOfDesk(
  desk: number,
  members: ReadonlyMap<number, Pick<Member, "desk" | "color" | "marker">>,
  you: number | null,
): RivalIdentity {
  return rivalIdentity(members.get(desk) ?? { desk, ...deskIdentity(desk) }, you);
}
