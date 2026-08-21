// How hard a key was hit.
//
// A computer has no idea how hard you press: a keyboard key is on or off, and a
// mouse reports no pressure worth the name. So an on-screen keyboard has to get
// its expression from somewhere else, and the convention — GarageBand does this,
// and it's what makes its on-screen keys feel alive — is *where* on the key you
// land. Down at the near edge is a hard hit; up at the far end is a gentle one.
//
// Without this every note a child plays is recorded at exactly the same
// strength, which is the difference between a melody that was played and one
// that was typed.

/** Softest a struck note can be. Never so quiet it reads as a missed key. */
export const MIN_STRIKE_VELOCITY = 0.55;
/** Hardest. The engine's gain staging and the master limiter both expect 1.0. */
export const MAX_STRIKE_VELOCITY = 1;

/** What a key played without a position — a computer key — is worth. */
export const TYPED_VELOCITY = 0.85;

/**
 * Velocity from where on the key the pointer landed: `offsetY` measured from
 * the top of the key, `height` the key's full height.
 *
 * Anything unmeasurable (a zero-height key mid-layout, a missing offset) falls
 * back to the typed strength rather than to silence — a note that doesn't sound
 * is far worse than one whose strength is a guess.
 */
export function strikeVelocity(offsetY: number, height: number): number {
  if (!Number.isFinite(offsetY) || !Number.isFinite(height) || height <= 0) {
    return TYPED_VELOCITY;
  }
  const depth = Math.min(1, Math.max(0, offsetY / height));
  return MIN_STRIKE_VELOCITY + depth * (MAX_STRIKE_VELOCITY - MIN_STRIKE_VELOCITY);
}
