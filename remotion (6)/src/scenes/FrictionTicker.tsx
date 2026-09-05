import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { sceneFadeOut } from "../components/SceneFade";
import { colors, fonts } from "../theme";
import { SCENE } from "../timings";

const items = [
  "Sign in to watch",
  "Premium to download",
  "1080p cap on free tier",
  "Offline viewing blocked",
  "Link expires in 7 days",
];

export const FrictionTicker = () => {
  const frame = useCurrentFrame();
  const out = sceneFadeOut(frame, SCENE.friction);

  const offset = interpolate(frame, [0, SCENE.friction], [120, -920], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${colors.ink} 0%, #1a1a1a 100%)`,
        fontFamily: fonts.sans,
        justifyContent: "center",
        opacity: out,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 120,
          left: 120,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 2.5,
          textTransform: "uppercase",
          color: "rgba(255,255,255,.4)",
        }}
      >
        Every step blocks the save
      </div>

      <div
        style={{
          display: "flex",
          gap: 24,
          transform: `translateX(${offset}px)`,
          paddingLeft: 120,
        }}
      >
        {[...items, ...items].map((label, i) => (
          <div
            key={`${label}-${i}`}
            style={{
              flexShrink: 0,
              padding: "28px 36px",
              borderRadius: 16,
              background: i % 2 === 0 ? colors.white : colors.champagneSoft,
              border: `2px solid ${i % 2 === 0 ? colors.border : "transparent"}`,
              boxShadow: "0 20px 50px rgba(0,0,0,.25)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 4,
                borderRadius: 99,
                background: colors.ruby,
                marginBottom: 16,
              }}
            />
            <div
              style={{
                fontFamily: fonts.display,
                fontSize: 36,
                color: colors.ink,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
