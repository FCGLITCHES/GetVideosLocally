import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { sceneFadeOut } from "../components/SceneFade";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

const steps = [
  { label: "Watch in browser", icon: "▶" },
  { label: "Lose offline access", icon: "✕" },
  { label: "Pay to unlock", icon: "$" },
  { label: "Repeat next month", icon: "↻" },
];

export const StreamTrapLoop = () => {
  const frame = useCurrentFrame();
  const out = sceneFadeOut(frame, SCENE.loop);

  const progress = interpolate(frame, [20, SCENE.loop - 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
          top: 100,
          fontSize: 48,
          fontWeight: 780,
          letterSpacing: -1.2,
          color: colors.ink,
          textAlign: "center",
          width: 1100,
        }}
      >
        {copy.loopHeadline}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          marginTop: 60,
        }}
      >
        {steps.map((step, i) => {
          const active = progress > i / steps.length;
          const pulse = interpolate(
            frame,
            [30 + i * 22, 30 + i * 22 + 16],
            [0.92, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          return (
            <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  width: 200,
                  padding: "28px 20px",
                  borderRadius: 18,
                  background: active ? colors.white : "rgba(255,255,255,.6)",
                  border: `2px solid ${active ? colors.ruby : colors.border}`,
                  boxShadow: active
                    ? "0 16px 40px rgba(155,17,30,.12)"
                    : "none",
                  textAlign: "center",
                  transform: `scale(${active ? pulse : 0.96})`,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 99,
                    background: active ? colors.ruby : colors.border,
                    color: active ? colors.white : colors.muted,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 800,
                    margin: "0 auto 14px",
                  }}
                >
                  {step.icon}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: colors.ink,
                    lineHeight: 1.2,
                  }}
                >
                  {step.label}
                </div>
              </div>
              {i < steps.length - 1 ? (
                <div
                  style={{
                    width: 56,
                    height: 3,
                    background: progress > (i + 0.5) / steps.length
                      ? colors.ruby
                      : colors.border,
                    margin: "0 8px",
                    borderRadius: 99,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
