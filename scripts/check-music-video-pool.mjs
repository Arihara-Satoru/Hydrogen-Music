import assert from "node:assert/strict";
import { pickMusicVideoPoolEntry } from "../src/utils/musicVideoPool.mjs";

const videos = [
  { path: "A.mp4", available: true },
  { path: "B.mp4", available: true },
  { path: "C.mp4", available: true },
];

assert.equal(pickMusicVideoPoolEntry([], "", () => 0), null);
assert.equal(
  pickMusicVideoPoolEntry([{ path: "missing.mp4", available: false }]),
  null,
);
assert.equal(pickMusicVideoPoolEntry(videos, "A.mp4", () => 0).path, "B.mp4");
assert.equal(
  pickMusicVideoPoolEntry(videos, "A.mp4", () => 1).path,
  "C.mp4",
);
assert.equal(
  pickMusicVideoPoolEntry([videos[0]], "A.mp4", () => 0.5).path,
  "A.mp4",
);

console.log("music video pool checks passed");
