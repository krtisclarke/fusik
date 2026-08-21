// One track's signal path: its own volume, and its own echo.
//
// Sound lives on the blocks (each has its own synth settings), but an echo is
// the *space* an instrument sits in rather than what the instrument is — so it
// belongs to the track, and every block on that track gets it.
//
// The kid-facing control is a single "Echo" slider. Behind it, three things move
// together so there is no way to set it to something unmusical:
//   - how loud the repeats are (the send),
//   - how many there are before they die away (the feedback),
//   - and the gap between them, which follows the song's tempo.
//
// Built like the master chain — takes a BaseAudioContext, so live playback and
// the offline render used by Export share one implementation and cannot drift.

/** The delay never feeds back hard enough to build up on itself. */
const MAX_FEEDBACK = 0.55;
/** How loud the first repeat is with the slider all the way up. */
const MAX_SEND = 0.6;
/** Longest gap we ever need: an eighth note at the slowest tempo (20bpm). */
const MAX_DELAY_SECONDS = 2;

export interface TrackChain {
  /** The track's voices connect here. */
  input: GainNode;
  /** Track volume, mute and solo all land on this. */
  gain: AudioParam;
  /** Set the echo amount (0..1) and keep its repeats in time with the song. */
  setEcho(amount: number, bpm: number): void;
  disconnect(): void;
}

export function createTrackChain(ctx: BaseAudioContext, destination: AudioNode): TrackChain {
  const input = ctx.createGain(); // where this track's voices arrive
  // The track's fader — volume, mute and solo all land here, and BOTH the dry
  // sound and the echo's repeats pass through it. If the repeats went straight
  // to the bus instead, muting a track would silence the instrument but leave
  // its echo ringing on over everything else for seconds, and Export (which
  // skips muted tracks outright) would disagree with what was heard.
  const output = ctx.createGain();
  output.connect(destination);
  input.connect(output); // the dry sound

  const send = ctx.createGain();
  send.gain.value = 0; // silent until the child asks for echo
  const delay = ctx.createDelay(MAX_DELAY_SECONDS);
  const feedback = ctx.createGain();
  feedback.gain.value = 0;

  // Each repeat loses its top end, the way a real echo bouncing off a wall
  // does. Without this the repeats stay harsh and pile into a ringing mess.
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2600;

  // A loop that feeds back into itself will trap any DC offset the sound
  // carries — and a kick, whose pitch dives almost to nothing, carries plenty.
  // The audio part of the echo dies away properly but the offset does not: it
  // just sits there as a constant, silent-but-not-silent lump that eats
  // headroom from every other sound and never leaves. A high-pass has no gain
  // at all at 0 Hz, so putting one in the loop kills it at the source. Every
  // real delay unit does this.
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 30; // below the lowest note; only DC and rumble go

  input.connect(send);
  send.connect(delay);
  delay.connect(damp);
  damp.connect(dcBlock);
  dcBlock.connect(feedback);
  feedback.connect(delay); // the loop that makes repeat after repeat
  delay.connect(output); // the repeats, through the fader like everything else

  function setEcho(amount: number, bpm: number): void {
    const level = Math.min(1, Math.max(0, amount));
    // An eighth note, so repeats land on the song's own grid at any tempo.
    const eighthNote = Math.min(MAX_DELAY_SECONDS, 30 / Math.max(1, bpm));
    // This runs on every edit to the song, not just tempo changes, so only
    // touch the delay when the gap has actually moved — and glide when it has.
    // Jumping the read position while audio is still in the delay line clicks;
    // a short glide bends the pitch instead, the way tape echo does.
    if (Math.abs(delay.delayTime.value - eighthNote) > 1e-6) {
      if (ctx.currentTime === 0) delay.delayTime.value = eighthNote;
      else delay.delayTime.setTargetAtTime(eighthNote, ctx.currentTime, 0.05);
    }
    const sendLevel = level * MAX_SEND;
    const feedbackLevel = level * MAX_FEEDBACK;
    if (ctx.currentTime === 0) {
      // Offline render: the whole graph is set up before the clock moves, so a
      // ramp from zero would fade the first echo in and the exported file
      // wouldn't match what was heard. Set it outright.
      send.gain.value = sendLevel;
      feedback.gain.value = feedbackLevel;
      return;
    }
    // Live: ramp rather than jump, or the slider clicks as it moves.
    send.gain.setTargetAtTime(sendLevel, ctx.currentTime, 0.02);
    feedback.gain.setTargetAtTime(feedbackLevel, ctx.currentTime, 0.02);
  }

  function disconnect(): void {
    for (const node of [input, output, send, delay, feedback, damp, dcBlock]) node.disconnect();
  }

  return { input, gain: output.gain, setEcho, disconnect };
}
