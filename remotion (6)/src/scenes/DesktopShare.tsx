import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { sceneFadeIn, sceneFadeOut } from "../components/SceneFade";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

export const DesktopShare = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = sceneFadeOut(frame, SCENE.share);

  const panelIn = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 100 },
  });
  const toastIn = spring({
    frame: frame - 22,
    fps,
    config: { damping: 14, stiffness: 130 },
  });
  const scroll = interpolate(frame, [40, 72], [0, -36], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.dark,
        fontFamily: fonts.sans,
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 72,
          left: 120,
          fontSize: 46,
          fontWeight: 780,
          letterSpacing: -1.2,
          color: colors.white,
          opacity: sceneFadeIn(frame, 10),
        }}
      >
        {copy.shareHeadline}
      </div>

      <div
        style={{
          position: "absolute",
          top: 180,
          left: "50%",
          marginLeft: -520,
          width: 1040,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 40px 100px rgba(0,0,0,.45)",
          transform: `translateY(${(1 - panelIn) * 48}px)`,
          opacity: panelIn,
        }}
      >
        <div
          style={{
            height: 44,
            background: "#1a1f2e",
            display: "flex",
            alignItems: "center",
            padding: "0 18px",
            gap: 8,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div
              key={c}
              style={{
                width: 12,
                height: 12,
                borderRadius: 99,
                background: c,
              }}
            />
          ))}
          <div
            style={{
              marginLeft: 16,
              flex: 1,
              height: 28,
              borderRadius: 8,
              background: "#0d1117",
              color: "rgba(255,255,255,.55)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              padding: "0 14px",
            }}
          >
            creator-site.com/8k-hdr-showreel
          </div>
        </div>

        <div
          style={{
            background: colors.paper,
            padding: "28px 32px 32px",
            position: "relative",
            minHeight: 420,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 24,
              right: 32,
              padding: "14px 18px",
              borderRadius: 12,
              background: colors.white,
              boxShadow: "0 12px 32px rgba(17,17,17,.12)",
              border: `1px solid ${colors.border}`,
              transform: `translateY(${(1 - Math.min(toastIn, 1)) * -16}px)`,
              opacity: Math.min(toastIn, 1),
              minWidth: 280,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: colors.ruby,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              Link copied
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 16,
                fontWeight: 700,
                color: colors.ink,
              }}
            >
              8K HDR showreel — watch online only
            </div>
          </div>

          <div style={{ transform: `translateY(${scroll}px)` }}>
            {[
              { tag: "Trending", title: "OLED demo reel hits feeds", meta: "48K views today" },
              { tag: "Shared", title: "Save this before it disappears", meta: "Forum thread" },
              { tag: "Reminder", title: "No download button on this page", meta: "Top comment" },
            ].map((item) => (
              <div
                key={item.title}
                style={{
                  marginBottom: 14,
                  padding: "18px 20px",
                  borderRadius: 14,
                  background: colors.white,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: colors.ruby,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {item.tag}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 20,
                    fontWeight: 700,
                    color: colors.ink,
                  }}
                >
                  {item.title}
                </div>
                <div style={{ marginTop: 4, fontSize: 14, color: colors.muted }}>
                  {item.meta}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
