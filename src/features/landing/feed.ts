/** The live feed's fiction (bible 7.8): a random ring room and a stream that started up to an hour ago. */
export type FeedFacts = { roomNumber: number; elapsedSeconds: number };

export function drawFeedFacts(random: () => number = Math.random): FeedFacts {
  return {
    roomNumber: 100 + Math.floor(random() * 900),
    elapsedSeconds: Math.floor(random() * 3600),
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/** `HH:MM:SS` of an elapsed second count. */
export function timecode(elapsedSeconds: number): string {
  const s = Math.max(0, Math.floor(elapsedSeconds));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}
