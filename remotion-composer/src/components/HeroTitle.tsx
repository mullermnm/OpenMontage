import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

interface HeroTitleProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
  // Opening-hook treatment (owner feedback: "the starting hook for a video
  // should be done in a way that is engaging"). When true, beats[0] renders
  // with pattern-interrupt energy instead of the standard hero-title look:
  // an accent-color flash frame, a tighter word-by-word slam-in, the
  // emphasized word underlined, and a slow zoom on the background.
  isHook?: boolean;
  // Index into title.split(" ") to render in accent + underline. Normally
  // computed upstream (om_agent's cheap "longest word / word after a
  // Stop-Why-number cue" heuristic) and passed down; falls back to the
  // longest word here so a missing prop still looks intentional.
  emphasisIndex?: number;
}

export const HeroTitle: React.FC<HeroTitleProps> = ({
  title,
  subtitle,
  accentColor = "#22D3EE",
  isHook = false,
  emphasisIndex,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Staggered letter-by-letter spring, grouped into per-WORD nowrap spans —
  // rendering each character as its own flex item let the flex-wrap
  // container break lines mid-word ("ch arging" on a real 9:16 render,
  // 2026-07-10). Words are the wrap unit; characters animate inside them.
  const words = title.split(" ").filter((w) => w.length > 0);
  // Auto-fit: long hook lines scale down instead of overflowing/wrapping
  // onto 4+ lines. Stepped, not continuous — hooks are one sentence.
  const titleFontSize = title.length <= 40 ? 72 : title.length <= 60 ? 58 : 48;
  const titleChars = title.split("");
  let charCursor = 0;

  // Emphasized word: the prop wins; a longest-word fallback keeps the hook
  // treatment looking deliberate even if the caller forgot to pass one.
  const fallbackEmphasisIndex = words.reduce(
    (best, w, idx) => (w.length > words[best].length ? idx : best),
    0
  );
  const resolvedEmphasisIndex =
    typeof emphasisIndex === "number" && emphasisIndex >= 0 && emphasisIndex < words.length
      ? emphasisIndex
      : fallbackEmphasisIndex;

  // Hook words slam in word-by-word (tighter stagger, snappier spring) —
  // non-hook beats keep the original gentle per-character cascade.
  const hookWordStaggerFrames = 3;

  // Subtle slow zoom on the background for the whole beat. `durationInFrames`
  // is the composition's total length, not this Sequence's — same
  // approximation ImageScene/BackgroundImageLayer already use elsewhere in
  // this file's siblings, which in practice reads as a slow, barely-there
  // drift rather than a full zoom-to-completion (fine for "subtle").
  const zoomProgress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bgZoom = isHook ? 1 + zoomProgress * 0.06 : 1;

  // 3-4 frame full-bleed accent flash at frame 0 — a pattern interrupt before
  // any text has even landed.
  const flashOpacity = isHook
    ? interpolate(frame, [0, 4], [0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {/* Background layer — separate from the text so the slow zoom doesn't
          also scale the title. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0.55) 100%)",
          transform: isHook ? `scale(${bgZoom})` : undefined,
        }}
      />

      {isHook && (
        <AbsoluteFill
          style={{ background: accentColor, opacity: flashOpacity, pointerEvents: "none" }}
        />
      )}

      <div style={{ textAlign: "center", maxWidth: "85%" }}>
        {/* Main title with per-character spring, word-safe wrapping */}
        <div
          style={{
            fontSize: titleFontSize,
            fontWeight: 800,
            fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
            lineHeight: 1.2,
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            columnGap: "0.3em",
          }}
        >
          {words.map((word, wi) => {
            const wordStart = charCursor;
            charCursor += word.length + 1; // +1 for the space
            const isEmphasis = isHook && wi === resolvedEmphasisIndex;
            const wordDelay = isHook ? wi * hookWordStaggerFrames : null;
            return (
              <span key={wi} style={{ display: "inline-flex", whiteSpace: "nowrap", position: "relative" }}>
                {word.split("").map((char, ci) => {
                  const i = wordStart + ci;
                  const delay = wordDelay ?? i * 1.2;
                  const charSpring = spring({
                    frame: frame - delay,
                    fps,
                    config: isHook
                      ? { damping: 10, stiffness: 260 } // tighter, snappier slam with overshoot
                      : { damping: 12, stiffness: 150 },
                  });

                  return (
                    <span
                      key={ci}
                      style={{
                        display: "inline-block",
                        opacity: charSpring,
                        transform: `translateY(${interpolate(charSpring, [0, 1], [30, 0])}px) scale(${interpolate(charSpring, [0, 1], [isHook ? 0.6 : 1, 1])})`,
                        color: isEmphasis || (!isHook && wi === 0) ? accentColor : "#F8FAFC",
                      }}
                    >
                      {char}
                    </span>
                  );
                })}

                {/* Hand-drawn-style underline that draws in under the
                    emphasized word once its slam-in has landed. Percentage
                    sizing (not a fixed pixel width) so it always matches the
                    actual rendered word regardless of length. */}
                {isEmphasis && (
                  <svg
                    viewBox="0 0 100 12"
                    preserveAspectRatio="none"
                    style={{ position: "absolute", left: 0, right: 0, bottom: -10, width: "100%", height: 12, overflow: "visible" }}
                  >
                    <path
                      d="M2,7 Q20,2 35,7 T65,6 T98,8"
                      fill="none"
                      stroke={accentColor}
                      strokeWidth={5}
                      strokeLinecap="round"
                      pathLength={100}
                      strokeDasharray={100}
                      strokeDashoffset={interpolate(
                        spring({
                          frame: frame - (wordDelay ?? 0) - 6,
                          fps,
                          config: { damping: 20, stiffness: 90 },
                        }),
                        [0, 1],
                        [100, 0],
                        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                      )}
                    />
                  </svg>
                )}
              </span>
            );
          })}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              marginTop: 20,
              opacity: spring({
                frame: frame - titleChars.length * 1.2 - 5,
                fps,
                config: { damping: 20 },
              }),
              fontSize: 28,
              fontWeight: 400,
              color: "#A78BFA",
              fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Animated underline under the whole title — skipped for hook
            beats, which already draw an underline under the emphasized
            word specifically. */}
        {!isHook && (
          <div
            style={{
              margin: "24px auto 0",
              height: 3,
              backgroundColor: accentColor,
              borderRadius: 2,
              width: interpolate(
                spring({
                  frame: frame - 15,
                  fps,
                  config: { damping: 15, stiffness: 60 },
                }),
                [0, 1],
                [0, 400]
              ),
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
