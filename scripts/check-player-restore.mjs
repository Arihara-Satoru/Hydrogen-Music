import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const playerSource = await readFile(
  new URL("../src/utils/player.js", import.meta.url),
  "utf8",
);

function extractFunction(name) {
  const match = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(
    playerSource,
  );
  assert.ok(match, `missing ${name}`);
  const bodyStart = playerSource.indexOf(") {", match.index) + 2;
  assert.ok(bodyStart > 1, `missing body for ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < playerSource.length; index++) {
    if (playerSource[index] === "{") depth++;
    if (playerSource[index] === "}" && --depth === 0) {
      return playerSource.slice(match.index, index + 1).replace(/^export\s+/, "");
    }
  }
  throw new Error(`unterminated ${name}`);
}

const hasSameSongIdsSource = extractFunction("hasSameSongIds");
const loadLastSongSource = extractFunction("loadLastSong");
const getAdjacentSongInfoSource = extractFunction("getAdjacentSongInfo");

function createRestoreHarness(snapshot, initialShuffleIndex) {
  const songList = { value: null };
  const shuffledList = { value: null };
  const currentIndex = { value: 0 };
  const shuffleIndex = { value: initialShuffleIndex };
  const songId = { value: null };
  const progress = { value: 0 };
  const playMode = { value: 3 };
  let repaired = 0;

  const findSongIndexById = (id) =>
    (songList.value || []).findIndex(
      (song) => song && String(song.id) === String(id),
    );
  const setId = (id, index) => {
    songId.value = id;
    shuffleIndex.value = index;
    currentIndex.value = Math.max(0, findSongIndexById(id));
  };
  const setShuffledList = () => {
    const currentSong = songList.value[currentIndex.value];
    shuffledList.value = [
      currentSong,
      ...songList.value.filter((song) => song !== currentSong),
    ];
    shuffleIndex.value = 0;
  };
  const dependencies = {
    loadLast: true,
    loadStoredPlaylist: async () => snapshot,
    songList,
    shuffledList,
    currentIndex,
    shuffleIndex,
    songId,
    progress,
    playMode,
    findSongIndexById,
    setId,
    setShuffledList,
    savePlaylist: () => repaired++,
    syncWindowsTaskbarPlaybackState: () => {},
    getSongUrl: async () => {},
  };
  const names = Object.keys(dependencies);
  const loadLastSong = Function(
    ...names,
    `${hasSameSongIdsSource}\n${loadLastSongSource}\nreturn loadLastSong;`,
  )(...Object.values(dependencies));

  return {
    loadLastSong,
    state: { songList, shuffledList, currentIndex, shuffleIndex, songId },
    repaired: () => repaired,
  };
}

const songs = Array.from({ length: 148 }, (_, index) => ({
  id: `song-${index}`,
  type: "local",
}));
const broken = createRestoreHarness(
  {
    songList: songs,
    shuffledList: [songs[0]],
    songId: songs[27].id,
    currentIndex: 8,
    progress: 12,
  },
  1,
);
await broken.loadLastSong();
assert.equal(broken.state.currentIndex.value, 27);
assert.equal(broken.state.shuffleIndex.value, 0);
assert.equal(broken.state.shuffledList.value.length, songs.length);
assert.equal(broken.state.shuffledList.value[0].id, songs[27].id);
assert.equal(broken.repaired(), 1);

const validQueue = songs.slice().reverse();
const valid = createRestoreHarness(
  {
    songList: songs,
    shuffledList: validQueue,
    songId: songs[27].id,
    currentIndex: 27,
    progress: 0,
  },
  1,
);
await valid.loadLastSong();
assert.equal(valid.state.shuffleIndex.value, validQueue.indexOf(songs[27]));
assert.equal(valid.repaired(), 0);

const navigationRefs = {
  listInfo: { value: null },
  playMode: { value: 3 },
  songList: { value: songs },
  shuffledList: { value: [songs[0]] },
  currentIndex: { value: 27 },
  shuffleIndex: { value: 1 },
  songId: { value: songs[27].id },
};
const getAdjacentSongInfo = Function(
  ...Object.keys(navigationRefs),
  `${getAdjacentSongInfoSource}\nreturn getAdjacentSongInfo;`,
)(...Object.values(navigationRefs));
assert.deepEqual(getAdjacentSongInfo(1), { id: songs[0].id, index: 0 });
assert.deepEqual(getAdjacentSongInfo(-1), { id: songs[0].id, index: 0 });

console.log("player restore checks passed");
