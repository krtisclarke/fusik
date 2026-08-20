// Small helpers for generating unique ids for tracks, notes, etc.
// Uses the platform's crypto (present in both browsers and Node 20+).

function randomId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  // Keep it short and readable; collisions are astronomically unlikely.
  return `${prefix}_${uuid.replace(/-/g, '').slice(0, 10)}`;
}

export const newTrackId = () => randomId('trk');
export const newNoteId = () => randomId('note');
export const newGroupId = () => randomId('grp');
export const newSectionId = () => randomId('sec');
export const newEntryId = () => randomId('arr');
