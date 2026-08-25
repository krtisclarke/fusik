import { describe, it, expect } from 'vitest';
import { followPlayhead } from './follow';

// A 12-bar part at the usual zoom: 2304px of grid, ~872px of it visible.
const VIEW = 872;
const MAX = 1437; // scrollWidth - clientWidth for that part

describe('followPlayhead', () => {
  it('tracks a line that is on screen, and stays put', () => {
    const d = followPlayhead(false, 400, 0, VIEW, MAX, false);
    expect(d.tracking).toBe(true);
    expect(d.scrollTo).toBeUndefined();
  });

  it('flips the page when a tracked line walks off the right edge', () => {
    const d = followPlayhead(true, VIEW + 30, 0, VIEW, MAX, false);
    expect(d.tracking).toBe(false);
    expect(d.scrollTo).toBe(VIEW + 30 - 12);
  });

  it('flips home when a tracked line wraps back to the start', () => {
    // Looping: the line was near the end of the part, on screen, and is
    // suddenly at beat zero — far to the left of a view scrolled deep in.
    const d = followPlayhead(true, 4, 1400, VIEW, MAX, false);
    expect(d.scrollTo).toBe(0); // clamped: 4 - 12 would be negative
  });

  it('never chases a line the child scrolled away from', () => {
    // The view moved this check — the child dragged the map — and the line
    // ended up off screen because of it. That is a choice, not a departure.
    const d = followPlayhead(true, 2000, 0, VIEW, MAX, true);
    expect(d.tracking).toBe(false);
    expect(d.scrollTo).toBeUndefined();
  });

  it('does nothing while the line is off screen and untracked', () => {
    // Scrolled away earlier; the line is elsewhere, and stays their business.
    const d = followPlayhead(false, 2000, 0, VIEW, MAX, false);
    expect(d.tracking).toBe(false);
    expect(d.scrollTo).toBeUndefined();
  });

  it('resumes tracking when the loop brings the line to the child', () => {
    // They are looking at the start; the wrap carries the line into view.
    const d = followPlayhead(false, 40, 0, VIEW, MAX, false);
    expect(d.tracking).toBe(true);
  });

  it('clamps a flip at the end of the part', () => {
    const d = followPlayhead(true, 2300, 800, VIEW, MAX, false);
    expect(d.scrollTo).toBe(MAX);
  });

  it('keeps tracking through the slack at the exact edge', () => {
    // Right after a flip the line sits on the margin; a rounding hair past
    // either edge must not read as a departure.
    expect(followPlayhead(true, 800 - 1, 800, VIEW, MAX, false).tracking).toBe(true);
    expect(followPlayhead(true, 800 + VIEW + 1, 800, VIEW, MAX, false).tracking).toBe(true);
  });

  it('never flips when the whole part fits on screen', () => {
    // maxScroll is 0 and the line can never leave a view that shows it all.
    const d = followPlayhead(true, 700, 0, 768, 0, false);
    expect(d.tracking).toBe(true);
  });
});
