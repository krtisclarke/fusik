// Should the timeline chase the playhead right now? Pure decision, no DOM.
//
// The rule: **the view follows a line it was showing, and never chases one you
// scrolled away from.** While the playhead is on screen it is "tracked"; when
// a tracked line leaves the screen on its own — walks off the right edge, or
// wraps back to the start on loop — the view flips to the page it went to,
// like a page turning. But when the line leaves because the *view* moved (the
// child dragged the map or the trackpad to look at something), that is a
// choice, and the view stays where it was put. Tracking resumes by itself the
// moment the loop brings the line back into whatever is on screen.
//
// A page flip, not a continuous glide, on purpose: a child places blocks while
// the song plays, and a grid that is always sliding under the pointer would
// make that a fairground game. The grid holds still; only the turn of the page
// moves it.

export interface FollowDecision {
  /** Whether the playhead is now on screen (feeds the next call). */
  tracking: boolean;
  /** When set, scroll the view here (content px, already clamped). */
  scrollTo?: number;
}

/** How far from the view's left edge the line lands after a flip. */
const FLIP_MARGIN_PX = 12;

/**
 * One follow check.
 *
 * @param wasTracking whether the playhead was on screen at the last check
 * @param beatX       the playhead, in grid pixels from the part's start
 * @param scrollLeft  the view's current scroll position (content px)
 * @param gridViewW   how many pixels of grid are visible (view minus the
 *                    pinned header column)
 * @param maxScroll   the largest scrollLeft the container allows
 * @param viewMoved   the view moved since the last check for a reason that
 *                    wasn't this follower (the child scrolling)
 */
export function followPlayhead(
  wasTracking: boolean,
  beatX: number,
  scrollLeft: number,
  gridViewW: number,
  maxScroll: number,
  viewMoved: boolean,
): FollowDecision {
  // A hair of slack on both edges: the line's own width, rounding, and the
  // instant a flip lands it exactly on the margin.
  const visible = beatX >= scrollLeft - 1 && beatX <= scrollLeft + gridViewW + 1;
  if (visible) return { tracking: true };
  if (wasTracking && !viewMoved) {
    return {
      tracking: false,
      scrollTo: Math.max(0, Math.min(maxScroll, beatX - FLIP_MARGIN_PX)),
    };
  }
  return { tracking: false };
}
