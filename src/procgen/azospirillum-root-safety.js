// Compatibility facade retained for the simulator API. Geometry safety is now
// resolved deterministically when the azospirillum-root-ladder block is built.
export function createAzospirillumRootSafety({ rootGrowth }) {
  return {
    get platformCount() { return rootGrowth.platformCount; },
    update() {},
  };
}
