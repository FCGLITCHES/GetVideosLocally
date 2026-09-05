import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { fadeIn, fadeOut, ProductScreenshot } from "../components/ProductScreenshot";
import { colors, fonts } from "../theme";
import { SCENE } from "../timings";

const BENEFITS = [
  "No paywall.",
  "No arbitrary cap.",
  "No streaming-only lock-in.",
];

export const ResultScene = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.result - 12, SCENE.result - 2);

  const downloaded = fadeIn(frame, 0, 18);
  const uiDepth = interpolate(frame, [18, 42], [1, 0.88], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const fileIn = interpolate(frame, [30, 52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fileY = interpolate(fileIn, [0, 1], [30, 0]);
  const headline = fadeIn(frame, 118, 138);

  const benefitOpacities = BENEFITS.map((_, i) =>
    fadeIn(frame, 54 + i * 16, 68 + i * 16),
  );

  return (
    <AbsoluteFill
      style={{
        background: colors.ink,
        fontFamily: fonts.sans,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 72,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 52,
          fontWeight: 800,
          color: colors.white,
          opacity: downloaded * (1 - headline),
          letterSpacing: -1,
        }}
      >
        Downloaded.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 64,
          width: 1680,
          transform: `scale(${uiDepth})`,
        }}
      >
        <div style={{ position: "relative" }}>
          <ProductScreenshot
            src="Pic1.png"
            width={980}
            height={640}
            scale={1.22}
            focusX={62}
            focusY={52}
            enter={false}
          />
        </div>

        <div style={{ width: 520 }}>
          <div
            style={{
              background: colors.white,
              borderRadius: 16,
              padding: "24px 28px",
              display: "flex",
              alignItems: "center",
              gap: 18,
              opacity: fileIn,
              transform: `translateY(${fileY}px) scale(${0.97 + fileIn * 0.03})`,
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: colors.ruby,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: colors.white,
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              MP4
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: colors.ink }}>
                Best of OLED Demo HDR 8K.mp4
              </div>
              <div style={{ fontSize: 15, color: colors.muted, marginTop: 4 }}>
                1.07 GB · Saved locally
              </div>
            </div>
          </div>

          <div style={{ marginTop: 36 }}>
            {BENEFITS.map((text, i) => (
              <div
                key={text}
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: colors.white,
                  marginBottom: 14,
                  opacity: benefitOpacities[i],
                  transform: `translateX(${interpolate(benefitOpacities[i], [0, 1], [12, 0])}px)`,
                }}
              >
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 80,
          fontSize: 64,
          fontWeight: 800,
          color: colors.white,
          letterSpacing: -2,
          opacity: headline,
        }}
      >
        It&apos;s yours locally.
      </div>
    </AbsoluteFill>
  );
};
