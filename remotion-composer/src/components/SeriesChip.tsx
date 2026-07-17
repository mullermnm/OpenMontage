import { useVideoConfig } from "remotion";

/**
 * The in-video series container (research/series-product.md §5.4): native
 * platform series features are follower-gated, so the episode label must
 * live INSIDE the video — "Part 2 of 7" as a small fixed-position chip,
 * visible from frame 0 (second 1 requirement), same position/size every
 * episode so the show is recognizable within 2 seconds.
 *
 * Positioned inside the cross-platform safe rectangle (~x:90 on a
 * 1080-wide canvas; below the top-130px UI danger zone) — scaled off the
 * canvas so every aspect lands proportionally.
 */
export const SeriesChip: React.FC<{ label: string; accent?: string }> = ({
  label,
  accent = "#F59E0B",
}) => {
  const { width, height } = useVideoConfig();
  const fontSize = Math.round(width * 0.026);
  return (
    <div
      style={{
        position: "absolute",
        left: Math.round(width * 0.083),
        top: Math.round(height * 0.085),
        display: "inline-flex",
        alignItems: "center",
        gap: Math.round(fontSize * 0.4),
        padding: `${Math.round(fontSize * 0.38)}px ${Math.round(fontSize * 0.7)}px`,
        borderRadius: 999,
        background: "rgba(0, 0, 0, 0.55)",
        color: "#FFFFFF",
        fontSize,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        lineHeight: 1,
        zIndex: 50,
      }}
    >
      <span
        style={{
          width: Math.round(fontSize * 0.45),
          height: Math.round(fontSize * 0.45),
          borderRadius: 999,
          background: accent,
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  );
};
