import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, copy, fonts } from "../theme";

export const CallToAction = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logo = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120 },
  });
  const wordmark = spring({
    frame: frame - 10,
    fps,
    config: { damping: 16, stiffness: 110 },
  });
  const button = spring({
    frame: frame - 22,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const urlIn = interpolate(frame, [44, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.ruby,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.sans,
        color: colors.white,
      }}
    >
      <Img
        src={staticFile("logo.png")}
        style={{
          width: 168,
          height: 168,
          opacity: Math.min(logo, 1),
          transform: `scale(${0.72 + Math.min(logo, 1) * 0.28}) rotate(${interpolate(logo, [0, 1], [-8, 0], { extrapolateRight: "clamp" })}deg)`,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 64,
          opacity: Math.min(wordmark, 1),
          transform: `translateY(${interpolate(wordmark, [0, 1], [16, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        {copy.productName}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 22,
          opacity: Math.min(wordmark, 1) * 0.86,
          letterSpacing: 0.3,
        }}
      >
        {copy.promise}
      </div>
      <div
        style={{
          marginTop: 36,
          background: colors.white,
          color: colors.ruby,
          borderRadius: 12,
          padding: "18px 42px",
          fontSize: 26,
          fontWeight: 800,
          opacity: Math.min(button, 1),
          transform: `translateY(${interpolate(button, [0, 1], [18, 0], { extrapolateRight: "clamp" })}px) scale(${0.94 + Math.min(button, 1) * 0.06})`,
        }}
      >
        {copy.ctaButton}
      </div>
      <div
        style={{
          marginTop: 22,
          fontSize: 20,
          fontWeight: 600,
          opacity: urlIn,
          letterSpacing: 0.2,
        }}
      >
        {copy.siteUrl}
      </div>
    </AbsoluteFill>
  );
};
