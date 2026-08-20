// Arrangement math: where each part sits in the whole song, in beats.
//
// The song is the arrangement — sections played in order. These helpers map
// between "absolute beat in the song" and "which entry, which beat inside its
// section". Pure functions, like everything in model/.

import type { Project, Section } from './types';
import { barsToBeats } from './time';

export function sectionById(project: Project, sectionId: string): Section | undefined {
  return project.sections.find((s) => s.id === sectionId);
}

/** How many beats one section spans. */
export function sectionBeats(section: Section, project: Project): number {
  return barsToBeats(section.lengthBars, project.timeSignature);
}

/** One resolved slot of the song: which section, where it starts, how long. */
export interface ResolvedEntry {
  entryId: string;
  sectionId: string;
  /** Absolute beat in the song where this slot begins. */
  startBeat: number;
  /** The slot's length in beats (its section's length). */
  lengthBeats: number;
}

/** The arrangement resolved to absolute song positions. Dangling ids are skipped. */
export function resolveArrangement(project: Project): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  let at = 0;
  for (const entry of project.arrangement) {
    const section = sectionById(project, entry.sectionId);
    if (!section) continue;
    const len = sectionBeats(section, project);
    out.push({ entryId: entry.id, sectionId: section.id, startBeat: at, lengthBeats: len });
    at += len;
  }
  return out;
}

/** Total length of the whole song in beats. */
export function songBeats(project: Project): number {
  return resolveArrangement(project).reduce((sum, e) => sum + e.lengthBeats, 0);
}

/**
 * Which slot an absolute song beat falls in, and how far into its section.
 * Returns null when the beat is outside the song (or the song is empty).
 */
export function songPositionAt(
  project: Project,
  absBeat: number,
): { entry: ResolvedEntry; entryIndex: number; beatInSection: number } | null {
  const entries = resolveArrangement(project);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (absBeat >= e.startBeat && absBeat < e.startBeat + e.lengthBeats) {
      return { entry: e, entryIndex: i, beatInSection: absBeat - e.startBeat };
    }
  }
  return null;
}
