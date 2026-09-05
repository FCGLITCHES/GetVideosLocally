import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { colors, fonts } from "../theme";
import { fadeOut } from "../components/ScreenshotFrame";
import { SCENE } from "../timings";

const steps = [
  { label: "Subscribe", icon: "💳" },
  { label: "Stream only", icon: "☁️" },
  { label: "Lose access", icon: "🔒" },
  { label: "Pay again", icon: "↻" },
];

export const SubscriptionCycle = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.cycle - 12, SCENE.cycle - 2);

  const bgPhase = interpolate(frame, [0, 45, 90, 135], [0, 1, 2, 3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const backgrounds = [
    colors.paper,
    "#fde8ea",
    "#f4f5f7",
    colors.champagneSoft,
  ];
  const bg =
    backgrounds[Math.min(Math.floor(bgPhase), backgrounds.length - 1)];

  const rotation = interpolate(frame, [0, SCENE.cycle], [0, 360], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: bg,
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
          fontSize: 52,
          fontWeight: 780,
          letterSpacing: -1.5,
          color: colors.ink,
          textAlign: "center",
          width: 1200,
        }}
      >
        Platforms apologize. Viewers still cannot keep the file.
      </div>

      <div
        style={{
          position: "relative",
          width: 720,
          height: 720,
          transform: `rotate(${rotation * 0.08}deg)`,
        }}
      >
        {steps.map((step, i) => {
          const angle = (i / steps.length) * Math.PI * 2 - Math.PI / 2;
          const radius = 260;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const pulse = interpolate(
            frame,
            [i * 24, i * 24 + 18],
            [0.85, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          return (
            <div
              key={step.label}
              style={{
                position: "absolute",
                left: 360 + x - 110,
                top: 360 + y - 72,
                width: 220,
                height: 144,
                borderRadius: 999,
                background: colors.white,
                border: `2px solid ${colors.border}`,
                boxShadow: "0 18px 50px rgba(17,17,17,.08)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                transform: `scale(${pulse})`,
              }}
            >
              <div style={{ fontSize: 34 }}>{step.icon}</div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 22,
                  fontWeight: 800,
                  color: colors.ink,
                }}
              >
                {step.label}
              </div>
            </div>
          );
        })}

        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 180,
            height: 180,
            marginLeft: -90,
            marginTop: -90,
            borderRadius: 999,
            background: colors.ruby,
            color: colors.white,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontSize: 22,
            fontWeight: 800,
            lineHeight: 1.25,
            padding: 20,
            boxSizing: "border-box",
          }}
        >
          The loop repeats
        </div>
      </div>
    </AbsoluteFill>
  );
};
