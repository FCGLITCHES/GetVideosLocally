import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ScreenshotFrame, fadeIn } from "../components/ScreenshotFrame";
import { colors, copy, fonts } from "../theme";

export const CallToAction = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const uiOut = interpolate(frame, [0, 28], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const gradientIn = interpolate(frame, [18, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const logo = spring({
    frame: frame - 34,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const button = spring({
    frame: frame - 52,
    fps,
    config: { damping: 15, stiffness: 120 },
  });
  const url = fadeIn(frame, 68, 86);

  return (
    <AbsoluteFill style={{ fontFamily: fonts.sans }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: uiOut,
        }}
      >
        <ScreenshotFrame
          src="Pic4.png"
          width={1680}
          height={920}
          scale={1}
          focusX={50}
          focusY={50}
          enter={false}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, ${colors.gradientStart} 0%, ${colors.ruby} 100%)`,
          justifyContent: "center",
          alignItems: "center",
          opacity: gradientIn,
        }}
      >
        <Img
          src={staticFile("logo.png")}
          style={{
            width: 140,
            height: 140,
            opacity: Math.min(logo, 1),
            transform: `scale(${0.78 + Math.min(logo, 1) * 0.22})`,
          }}
        />
        <div
          style={{
            marginTop: 28,
            fontFamily: fonts.display,
            fontSize: 68,
            color: colors.white,
            letterSpacing: -1,
            opacity: Math.min(logo, 1),
          }}
        >
          {copy.productName}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 28,
            fontWeight: 600,
            color: "rgba(255,255,255,.9)",
            opacity: Math.min(logo, 1),
          }}
        >
          {copy.promise}
        </div>
        <div
          style={{
            marginTop: 40,
            background: colors.white,
            color: colors.ruby,
            borderRadius: 14,
            padding: "18px 38px",
            fontSize: 26,
            fontWeight: 800,
            opacity: Math.min(button, 1),
            transform: `translateY(${interpolate(button, [0, 1], [16, 0], { extrapolateRight: "clamp" })}px)`,
            boxShadow: "0 18px 50px rgba(17,17,17,.18)",
          }}
        >
          {copy.cta}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 24,
            fontWeight: 700,
            color: colors.white,
            opacity: url,
          }}
        >
          {copy.url}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 36,
            fontSize: 17,
            color: "rgba(255,255,255,.72)",
            opacity: url,
          }}
        >
          {copy.footer}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
