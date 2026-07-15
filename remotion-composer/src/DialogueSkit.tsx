import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CaptionOverlay, WordCaption } from "./components/CaptionOverlay";

// The skit background can be a VIDEO (user footage / gameplay loop) OR a still
// IMAGE (the generated animated-sitcom SETTING when there's no footage). Feeding
// an image to <OffthreadVideo> crashes the render (rc=1), so pick the element by
// extension. Query strings on signed URLs are stripped before the test.
function isImageSrc(src: string): boolean {
  const path = src.split("?")[0]!.toLowerCase();
  return /\.(png|jpe?g|webp|gif|avif|bmp)$/.test(path);
}

// Resolve asset path — URLs pass through; a bare filename (e.g. the combined
// narration track written into public/ by the worker) needs staticFile() to
// resolve against Remotion's public dir. Mirrors Explainer.tsx's identical
// helper (kept local rather than shared — same small-helper convention this
// file already follows per component).
function resolveAsset(src: string): string {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  const clean = src.replace(/^file:\/\/\/?/, "");
  if (clean.startsWith("/") || /^[A-Za-z]:[\\/]/.test(clean)) {
    return `file:///${clean.replace(/\\/g, "/")}`;
  }
  return staticFile(clean);
}

// ---------------------------------------------------------------------------
// DialogueSkit — "Family Guy"-style multi-character comedy skit.
//
// Background footage/gameplay loop underneath; each speaking turn pops in
// that character's static portrait with a bounce animation (NOT full lip
// sync — that's the genre's authentic look, the captions carry the joke);
// word-level captions on top, same CaptionOverlay component every other
// composition in this file uses so the caption STYLE stays consistent
// across cinematic / avatar / skit content.
// ---------------------------------------------------------------------------

export interface DialogueSkitCharacterCue {
  character: string;
  /** Portrait image URL (uploaded or AI-generated cast member). */
  imageSrc: string;
  in_seconds: number;
  out_seconds: number;
  /** Alternates left/right by default when unset (even index → left). */
  position?: "left" | "right";
}

export interface DialogueSkitProps {
  [key: string]: unknown;
  /** Background footage — stock B-roll or a curated "gameplay-style" loop. */
  backgroundSrc: string;
  /** One entry per dialogue turn — who's "on screen" and when. */
  characters: DialogueSkitCharacterCue[];
  /** Combined narration track (all turns concatenated by the backend/worker
   *  before render — Remotion renders ONE audio timeline, not per-turn clips). */
  audioSrc?: string;
  /** Optional background-music bed (Suno-generated when premium tier + a
   *  key is configured; silently absent otherwise — see om_agent.py). Mixed
   *  as a second Audio layer at low volume rather than true sidechain
   *  ducking — matches Explainer's existing simple approach. */
  musicSrc?: string;
  musicVolume?: number;
  /** Word-level captions for the WHOLE combined track, in order. */
  captions: WordCaption[];
  /** Explicit total length — set by the caller from the real combined-audio
   *  duration so `calculateDialogueSkitMetadata` doesn't have to guess from
   *  caption/cue timing alone. */
  durationSeconds?: number;
  wordsPerPage?: number;
  fontSize?: number;
  highlightColor?: string;
}

const PORTRAIT_SIZE = 480;

const PortraitCue: React.FC<{ cue: DialogueSkitCharacterCue; index: number }> = ({
  cue,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Bounce/pop-in on entry — the genre's signature "character slaps onto
  // screen" beat — then a gentle idle bob for the rest of the cue.
  const entry = spring({ frame, fps, config: { damping: 10, stiffness: 180, mass: 0.6 } });
  const bob = Math.sin(frame / 8) * 6;
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const scale = 0.85 + entry * 0.15;
  const side = cue.position ?? (index % 2 === 0 ? "left" : "right");

  return (
    <div
      style={{
        position: "absolute",
        bottom: 340, // above the caption band
        [side]: 40,
        width: PORTRAIT_SIZE,
        height: PORTRAIT_SIZE,
        transform: `scale(${scale}) translateY(${bob}px)`,
        opacity: fadeOut,
        borderRadius: 24,
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
        border: "4px solid rgba(255, 255, 255, 0.85)",
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        src={resolveAsset(cue.imageSrc)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
};

export const DialogueSkit: React.FC<DialogueSkitProps> = ({
  backgroundSrc,
  characters,
  audioSrc,
  musicSrc,
  musicVolume = 0.18,
  captions,
  wordsPerPage = 4,
  fontSize = 52,
  highlightColor = "#F59E0B",
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1: background footage/gameplay clip. NOTE: doesn't loop yet —
          looping needs the clip's native duration (Remotion's `Loop` wrapper
          requires an explicit durationInFrames), which means probing the
          source file before render. Fine for v1 as long as sourced footage
          is at least as long as the skit; revisit if that's ever violated. */}
      {backgroundSrc &&
        (isImageSrc(backgroundSrc) ? (
          <Img
            src={resolveAsset(backgroundSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <OffthreadVideo
            src={resolveAsset(backgroundSrc)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ))}

      {/* Layer 2: narration track (all turns concatenated upstream) */}
      {audioSrc && <Audio src={resolveAsset(audioSrc)} />}

      {/* Layer 2b: optional music bed, low volume under the narration */}
      {musicSrc && <Audio src={resolveAsset(musicSrc)} volume={musicVolume} />}

      {/* Layer 3: character portraits, one Sequence per speaking turn */}
      {characters.map((cue, i) => {
        const from = Math.round(cue.in_seconds * fps);
        const duration = Math.round((cue.out_seconds - cue.in_seconds) * fps);
        if (duration <= 0) return null;
        return (
          <Sequence key={`${cue.character}-${i}`} from={from} durationInFrames={duration}>
            <PortraitCue cue={cue} index={i} />
          </Sequence>
        );
      })}

      {/* Layer 4: captions — topmost, same styling language as TalkingHead */}
      <CaptionOverlay
        words={captions}
        wordsPerPage={wordsPerPage}
        fontSize={fontSize}
        highlightColor={highlightColor}
        backgroundColor="rgba(0, 0, 0, 0.65)"
        color="#FFFFFF"
      />
    </AbsoluteFill>
  );
};
