import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Word-level caption for TikTok-style highlight display
export interface WordCaption {
  word: string;
  startMs: number;
  endMs: number;
}

// Six VERIFIED caption families (research/captions.md §2 — adversarially
// verified caption design spec). Each has a distinct fill/stroke/entrance
// treatment — see FAMILY_DEFAULTS and the per-word style switch in
// PageRenderer for the exact spec of each:
//   hormozi — ALL-CAPS 900 weight, white + thick dark stroke, ONE keyword
//             per page holds the accent PERSISTENTLY (§4 priority: number >
//             longest content word), per-word spring-pop entrance
//   beast   — the Komika-Axis-class comedy/hype display family (font
//             verified: MrBeast uses Komika Axis): ALL-CAPS, bold yellow +
//             black outline, per-word rotation jitter (stable per word),
//             bounce-in entrance
//   glow    — white bold with neon (accent-color) glow, active word glows
//             stronger, fade-slide-up entrance
//   karaoke — dim gray-white words, active word fills accent + scales 1.15
//   clean   — medium weight, sentence case, slim dark scrim pill (60-80%
//             opacity), gentle fade in/out PER PAGE (not per word)
//   boxed   — universal fallback: white text on translucent dark pill
export type CaptionFamily = "hormozi" | "beast" | "glow" | "karaoke" | "clean" | "boxed";

const CAPTION_FAMILIES: CaptionFamily[] = ["hormozi", "beast", "glow", "karaoke", "clean", "boxed"];

const FAMILY_DEFAULTS: Record<CaptionFamily, { fontSize: number; fontWeight: number }> = {
  hormozi: { fontSize: 54, fontWeight: 900 },
  beast: { fontSize: 50, fontWeight: 800 },
  glow: { fontSize: 46, fontWeight: 700 },
  karaoke: { fontSize: 44, fontWeight: 700 },
  clean: { fontSize: 34, fontWeight: 550 },
  boxed: { fontSize: 42, fontWeight: 700 },
};

// Deterministic pseudo-random in [-1, 1], stable per integer seed (word
// index) — every render of the same word gets the same jitter instead of
// flickering frame to frame. ponytail: a sine-hash is not a real PRNG;
// good enough for a ±3deg wobble, swap for a seeded RNG lib if visible
// clustering ever shows up.
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// Function words that must never win keyword emphasis (research/captions.md
// §4: "do NOT color function words").
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "am",
  "it", "its", "this", "that", "these", "those", "you", "your", "i", "we",
  "they", "he", "she", "my", "our", "their", "his", "her", "them", "us", "me",
  "if", "so", "do", "does", "did", "not", "no", "can", "will", "would",
  "could", "should", "have", "has", "had", "there", "here", "what", "when",
  "how", "why", "who", "which", "all", "just", "than", "then", "too", "very",
  "up", "down", "out", "into", "about", "over", "more", "most",
]);

// Pick the ONE keyword per page that gets the accent color (research/
// captions.md §4 priority: number/stat > product/brand name [not detectable
// here — skipped] > longest content word). Returns -1 when the page is all
// function words (no emphasis on that page). ponytail: naive heuristic per
// the verified spec — emotional-word detection would need a lexicon; add
// one if the longest-word fallback picks look flat.
export function emphasisIndex(words: string[]): number {
  const bare = words.map((w) => w.replace(/[^0-9a-zA-Z$%]/g, ""));
  const num = bare.findIndex((w) => /[0-9]/.test(w));
  if (num !== -1) return num;
  let best = -1;
  bare.forEach((w, i) => {
    if (!w || STOPWORDS.has(w.toLowerCase())) return;
    if (best === -1 || w.length > bare[best].length) best = i;
  });
  return best;
}

interface CaptionOverlayProps {
  words: WordCaption[];
  // How many words to show at once in a "page". The verified cross-platform
  // window is 3-5 words/page, default 4 (research/captions.md §1) — the
  // value is clamped into that window.
  wordsPerPage?: number;
  // Explicit overrides — omit to use the family's designed default.
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  highlightColor?: string;
  // Only consumed by the "boxed" pill family ("clean" forces its own
  // spec-defined dark scrim).
  backgroundColor?: string;
  fontFamily?: string;
  variant?: CaptionFamily | string;
  position?: "top" | "center" | "bottom";
}

interface CaptionPage {
  words: WordCaption[];
  startMs: number;
  endMs: number;
}

function buildPages(words: WordCaption[], wordsPerPage: number): CaptionPage[] {
  const pages: CaptionPage[] = [];
  for (let i = 0; i < words.length; i += wordsPerPage) {
    const pageWords = words.slice(i, i + wordsPerPage);
    if (pageWords.length === 0) continue;
    pages.push({
      words: pageWords,
      startMs: pageWords[0].startMs,
      endMs: pageWords[pageWords.length - 1].endMs,
    });
  }
  return pages;
}

const PageRenderer: React.FC<{
  page: CaptionPage;
  family: CaptionFamily;
  fontSize: number;
  fontWeight: number;
  color: string;
  highlightColor: string;
  backgroundColor: string;
  fontFamily: string;
  position: "top" | "center" | "bottom";
  safeMargin: number;
  // >0 → place the caption block's CENTER at (50% of frame height + offset)
  // instead of bottom-flush. Set for 9:16 — see CaptionOverlay below.
  centerYOffset: number;
}> = ({ page, family, fontSize, fontWeight, color, highlightColor, backgroundColor, fontFamily, position, safeMargin, centerYOffset }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentMs = page.startMs + (frame / fps) * 1000;

  // Page-level entrance — drives every family except hormozi/beast, which
  // slam in word-by-word instead (see wordSpring below).
  const pageEntrance = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120 },
  });

  // clean fades in AND out per page (research/captions.md §2: fade is the
  // calm/professional treatment, applied per PAGE, never per word).
  const pageFadeOut =
    family === "clean"
      ? interpolate(currentMs, [page.endMs, page.endMs + 250], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const usesPill = family === "boxed" || family === "clean";
  const perWordPop = family === "hormozi" || family === "beast";
  const uppercase = family === "hormozi" || family === "beast";
  // hormozi: ONE persistent accent keyword per page (§4) — computed once
  // from the page's words, not rotated with speech.
  const emphasisIdx = family === "hormozi" ? emphasisIndex(page.words.map((w) => w.word)) : -1;
  // 9:16 low-band placement: center the block at ~65% of frame height.
  const lowBand = position === "bottom" && centerYOffset > 0;
  const justifyContent =
    position === "top" ? "flex-start" : position === "center" || lowBand ? "center" : "flex-end";

  return (
    <AbsoluteFill
      style={{
        justifyContent,
        alignItems: "center",
        transform: lowBand ? `translateY(${centerYOffset}px)` : undefined,
        paddingTop: position === "top" ? 100 : 0,
        paddingBottom: position === "bottom" && !lowBand ? 80 : 0,
        paddingLeft: safeMargin,
        paddingRight: safeMargin,
      }}
    >
      <div
        style={{
          opacity: perWordPop ? 1 : pageEntrance * pageFadeOut,
          transform: perWordPop ? undefined : `translateY(${interpolate(pageEntrance, [0, 1], [20, 0])}px)`,
          // clean's scrim is part of its verified spec (60-80%-opacity dark
          // pill) — not themeable like boxed's.
          backgroundColor: family === "clean" ? "rgba(15, 23, 42, 0.7)" : usesPill ? backgroundColor : "transparent",
          borderRadius: family === "clean" ? 8 : 12,
          padding: family === "boxed" ? "14px 28px" : family === "clean" ? "8px 18px" : "0 4px",
          maxWidth: "100%",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize,
            fontWeight,
            fontFamily,
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
            textTransform: uppercase ? "uppercase" : "none",
          }}
        >
          {page.words.map((w, i) => {
            const isActive = w.startMs <= currentMs && w.endMs > currentMs;
            const isPast = w.endMs <= currentMs;

            // hormozi/beast: each word pops in individually, timed to when
            // it's actually spoken rather than the whole page fading in at
            // once — that's what makes them read as "pattern interrupt"
            // instead of a static subtitle.
            const wordDelayFrames = ((w.startMs - page.startMs) / 1000) * fps;
            const wordSpring = spring({
              frame: frame - wordDelayFrames,
              fps,
              config: family === "beast"
                ? { damping: 9, stiffness: 200 } // bouncier overshoot
                : { damping: 11, stiffness: 260 }, // hormozi: snappier pop
            });

            // Defaults (boxed / unrecognized family): legacy look.
            let wordColor = isActive ? highlightColor : isPast ? color : `${color}99`;
            let wordScale = isActive ? 1.15 : 1;
            let wordShadow = isActive
              ? `0 0 20px ${highlightColor}66, 0 2px 4px rgba(0,0,0,0.5)`
              : "0 2px 4px rgba(0,0,0,0.5)";
            let webkitStroke: string | undefined;
            let rotateDeg = 0;

            if (family === "hormozi") {
              // The ONE keyword holds the accent PERSISTENTLY — active-word
              // color rotation is karaoke's mechanic, not hormozi's
              // (research/captions.md §2/§4). The spring entrance above
              // still pops each word to the speech.
              wordColor = i === emphasisIdx ? highlightColor : "#FFFFFF";
              wordScale = 1;
              webkitStroke = "4px rgba(15,23,42,0.9)";
              wordShadow = "0 4px 10px rgba(0,0,0,0.45)";
            } else if (family === "beast") {
              wordColor = highlightColor || "#FFD900";
              webkitStroke = "3px #000000";
              wordShadow = "0 3px 0 rgba(0,0,0,0.6)";
              rotateDeg = seededUnit(i) * 3; // stable ±3deg, seeded by word index
              wordScale = isActive ? 1.08 : 1;
            } else if (family === "glow") {
              wordColor = "#FFFFFF";
              wordShadow = isActive
                ? `0 0 6px ${highlightColor}, 0 0 18px ${highlightColor}, 0 0 36px ${highlightColor}99, 0 2px 4px rgba(0,0,0,0.6)`
                : `0 0 4px ${highlightColor}88, 0 0 10px ${highlightColor}44, 0 2px 4px rgba(0,0,0,0.6)`;
              wordScale = 1;
            } else if (family === "karaoke") {
              wordColor = isActive ? highlightColor : "rgba(226,232,240,0.45)";
              wordScale = isActive ? 1.15 : 1;
            } else if (family === "clean") {
              // No per-word treatment at all — the whole page fades as one.
              wordColor = color;
              wordScale = 1;
              wordShadow = "none";
            }

            const entranceOpacity = perWordPop ? wordSpring : 1;
            const entranceY = perWordPop ? interpolate(wordSpring, [0, 1], [24, 0]) : 0;
            const entranceScale = perWordPop
              ? interpolate(wordSpring, [0, 1], [0.6, wordScale], { extrapolateRight: "clamp" })
              : wordScale;

            return (
              <span
                key={`${w.startMs}-${i}`}
                style={{
                  display: "inline-block",
                  color: wordColor,
                  opacity: entranceOpacity,
                  transform: `translateY(${entranceY}px) scale(${entranceScale}) rotate(${rotateDeg}deg)`,
                  WebkitTextStroke: webkitStroke,
                  textShadow: wordShadow,
                }}
              >
                {w.word}{i < page.words.length - 1 ? " " : ""}
              </span>
            );
          })}
        </span>
      </div>
    </AbsoluteFill>
  );
};

export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({
  words,
  wordsPerPage = 4,
  fontSize,
  fontWeight,
  color = "#F8FAFC",
  highlightColor = "#22D3EE",
  backgroundColor = "rgba(15, 23, 42, 0.75)",
  fontFamily = "Space Grotesk, Inter, system-ui, sans-serif",
  variant = "boxed",
  position = "bottom",
}) => {
  const { fps, width, height } = useVideoConfig();
  // Verified words-per-page window is 3-5, default 4 (research/captions.md §1).
  const pages = buildPages(words, Math.min(5, Math.max(3, Math.round(wordsPerPage))));
  const family: CaptionFamily = CAPTION_FAMILIES.includes(variant as CaptionFamily)
    ? (variant as CaptionFamily)
    : "boxed";
  const defaults = FAMILY_DEFAULTS[family];
  // Responsive to composition width — sizes above are tuned for a 1080px
  // portrait frame; scale proportionally for other compositions.
  const scale = width / 1080;
  const resolvedFontSize = (fontSize ?? defaults.fontSize) * scale;
  const resolvedFontWeight = fontWeight ?? defaults.fontWeight;
  // Horizontal safe area: >=60px side margins at 1080w, proportional beyond that.
  const safeMargin = Math.max(60, width * 0.0556);
  // 9:16 placement (research/captions.md §1, 3-source verified): the caption
  // block's CENTER sits at ~65% of frame height (y≈1250 on 1920) — clears
  // platform UI without entering TikTok's bottom ~480px in-feed reserve.
  // Flex center (50%) + 15%-of-height offset = 65%. 16:9 / 1:1 keep the
  // legacy bottom-flush behavior.
  const centerYOffset = height > width && position === "bottom" ? height * 0.15 : 0;

  return (
    <AbsoluteFill>
      {pages.map((page, i) => {
        const fromFrame = Math.round((page.startMs / 1000) * fps);
        const nextStart = pages[i + 1]?.startMs ?? page.endMs + 500;
        const duration = Math.max(
          1,
          Math.round(((nextStart - page.startMs) / 1000) * fps)
        );

        return (
          <Sequence key={i} from={fromFrame} durationInFrames={duration}>
            <PageRenderer
              page={page}
              family={family}
              fontSize={resolvedFontSize}
              fontWeight={resolvedFontWeight}
              color={color}
              highlightColor={highlightColor}
              backgroundColor={backgroundColor}
              fontFamily={fontFamily}
              position={position}
              safeMargin={safeMargin}
              centerYOffset={centerYOffset}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
