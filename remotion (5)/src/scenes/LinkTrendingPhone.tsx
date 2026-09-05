import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts } from "../theme";
import { fadeIn, fadeOut } from "../components/ScreenshotFrame";
import { SCENE } from "../timings";

export const LinkTrendingPhone = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const phoneIn = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 95 },
  });
  const notif = spring({
    frame: frame - 28,
    fps,
    config: { damping: 12, stiffness: 140 },
  });
  const scroll = interpolate(frame, [52, 90], [0, -48], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const out = fadeOut(frame, SCENE.phoneTrend - 12, SCENE.phoneTrend - 2);

  return (
    <AbsoluteFill
      style={{
        background: colors.champagneSoft,
        fontFamily: fonts.sans,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 88,
          left: 120,
          fontSize: 48,
          fontWeight: 780,
          letterSpacing: -1.5,
          color: colors.ink,
          opacity: fadeIn(frame, 6, 22),
        }}
      >
        A link goes viral. You still cannot keep it.
      </div>

      <div
        style={{
          width: 380,
          height: 780,
          borderRadius: 44,
          background: colors.ink,
          padding: 14,
          boxShadow: "0 40px 100px rgba(17,17,17,.22)",
          transform: `translateY(${(1 - phoneIn) * 80}px) scale(${0.9 + phoneIn * 0.1})`,
          opacity: phoneIn,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 32,
            background: "#fafafa",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              padding: "22px 20px 16px",
              fontSize: 13,
              fontWeight: 700,
              color: colors.muted,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            Shared links
          </div>

          <div style={{ transform: `translateY(${scroll}px)` }}>
            {[
              {
                tag: "#8KDemo",
                title: "Best of OLED Demo HDR 8K",
                meta: "Trending in your feeds",
              },
              {
                tag: "#HDR",
                title: "Ultra clarity showcase",
                meta: "12.4K shares today",
              },
              {
                tag: "#LocalFirst",
                title: "Why downloads disappear",
                meta: "Creator thread",
              },
            ].map((item) => (
              <div
                key={item.tag}
                style={{
                  margin: "0 16px 14px",
                  padding: "16px 18px",
                  borderRadius: 16,
                  background: colors.white,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <div
                  style={{
                    color: colors.ruby,
                    fontWeight: 800,
                    fontSize: 15,
                  }}
                >
                  {item.tag}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 18,
                    fontWeight: 700,
                    color: colors.ink,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 14,
                    color: colors.muted,
                  }}
                >
                  {item.meta}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              top: 88,
              padding: "16px 18px",
              borderRadius: 18,
              background: colors.white,
              boxShadow: "0 16px 40px rgba(17,17,17,.14)",
              transform: `translateY(${(1 - Math.min(notif, 1)) * -24}px) scale(${0.94 + Math.min(notif, 1) * 0.06})`,
              opacity: Math.min(notif, 1),
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted }}>
              NEW LINK SHARED
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 17,
                fontWeight: 800,
                color: colors.ink,
              }}
            >
              8K HDR demo is everywhere
            </div>
            <div style={{ marginTop: 4, fontSize: 14, color: colors.muted }}>
              Tap to watch — if the platform allows it
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
