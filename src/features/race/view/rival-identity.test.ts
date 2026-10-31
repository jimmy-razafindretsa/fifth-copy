import { describe, expect, it } from "vitest";
import { deskIdentity, MARKERS, memberSchema, type Member } from "@fifth-copy/protocol";
import { identityOfDesk, RIVAL_INKS, rivalIdentity } from "./rival-identity";

// Contract of #565 C2: the allocator's indices (Member.color, Member.marker, #557) become a colour role and
// a marker shape; over a full room every rival's (colour, shape) pair is unique; the viewer is `you`.

const member = (desk: number): Member =>
  memberSchema.parse({
    desk,
    name: `Crow-${100 + desk}`,
    isHost: false,
    isBot: false,
    ...deskIdentity(desk),
  });

describe("#565 C2 rivalIdentity", () => {
  it("maps member.color to rival-<color> and passes member.marker through, with the desk", () => {
    expect(rivalIdentity(member(1), 5)).toEqual({ colour: "rival-0", shape: "circle", desk: 1 });
    expect(rivalIdentity(member(12), 5)).toEqual({ colour: "rival-11", shape: "circle", desk: 12 });
    expect(rivalIdentity(member(13), 5)).toEqual({ colour: "rival-0", shape: "square", desk: 13 });
    expect(rivalIdentity(member(30), 5)).toEqual({
      colour: "rival-5",
      shape: "triangle",
      desk: 30,
    });
    expect(RIVAL_INKS).toHaveLength(12);
    expect(new Set(RIVAL_INKS).size).toBe(12);
  });

  it("over 29 rivals of a full room every (colour, shape) pair is unique", () => {
    for (const you of [1, 17, 30]) {
      const rivals = Array.from({ length: 30 }, (_, i) => member(i + 1)).filter(
        (m) => m.desk !== you,
      );
      expect(rivals).toHaveLength(29);
      const pairs = rivals.map((m) => {
        const id = rivalIdentity(m, you);
        expect(id.colour).toMatch(/^rival-(\d|1[01])$/);
        expect(MARKERS).toContain(id.shape);
        return `${id.colour}/${id.shape}`;
      });
      expect(new Set(pairs).size).toBe(29);
    }
  });

  it("the viewer is always you (red), whatever its allocated ink; a spectator sees only rivals", () => {
    for (let desk = 1; desk <= 30; desk++) {
      const id = rivalIdentity(member(desk), desk);
      expect(id.colour).toBe("you");
      expect(id.shape).toBe(deskIdentity(desk).marker);
      expect(rivalIdentity(member(desk), null).colour).not.toBe("you");
    }
  });

  it("a desk missing from the roster takes its allocator identity", () => {
    const roster = new Map([[3, member(3)]]);
    expect(identityOfDesk(3, roster, null)).toEqual(rivalIdentity(member(3), null));
    expect(identityOfDesk(14, roster, null)).toEqual({
      colour: "rival-1",
      shape: "square",
      desk: 14,
    });
    expect(identityOfDesk(14, roster, 14).colour).toBe("you");
  });
});
