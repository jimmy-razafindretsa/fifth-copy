import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { ENGINE_VERSION } from "@fifth-copy/engine";

export type Health = {
  ok: boolean;
  service: "race-server";
  engine: string;
  protocol: number;
  /** Live rooms; the deploy job waits for 0 before replacing the process (ADR 0012). */
  rooms: number;
  draining: boolean;
};

/** Pure so it can be unit-tested; main.ts wires it to GET /health. */
export function healthBody(state: { rooms: number; draining: boolean }): Health {
  return {
    ok: !state.draining,
    service: "race-server",
    engine: ENGINE_VERSION,
    protocol: PROTOCOL_VERSION,
    rooms: state.rooms,
    draining: state.draining,
  };
}
