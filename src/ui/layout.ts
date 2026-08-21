// Timeline geometry shared between the grid and the playhead. Keep these in
// sync with the matching values in styles.css (--row-h, --header-w).

export const PX_PER_BEAT = 48;
export const ROW_H = 78; // fits the header's three rows: name, mute/solo/volume, echo
export const HEADER_W = 176;
/** Height of one pitch row inside an instrument track's note-grid. */
export const PITCH_ROW_H = 20;

export function beatToX(beat: number): number {
  return beat * PX_PER_BEAT;
}

export function xToBeat(x: number): number {
  return x / PX_PER_BEAT;
}
