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
import { fadeOut } from "../components/ScreenshotFrame";
import { SCENE } from "../timings";

export const LogoReveal = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = fadeOut(frame, SCENE.logoReveal - 10, SCENE.logoReveal - 2);

  const mark = spring({
    frame,
    fps,
    config: { damping: 13, stiffness: 120 },
  });
  const word = spring({
    frame: frame - 14,
    fps,
    config: { damping: 15, stiffness: 110 },
  });
  const tag = spring({
    frame: frame - 28,
    fps,
    config: { damping: 16, stiffness: 100 },
  });

  const ring = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.white,
        fontFamily: fonts.sans,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 420,
          height: 420,
          borderRadius: 999,
          border: `2px solid rgba(155,17,30,${0.08 + ring * 0.12})`,
          transform: `scale(${0.7 + ring * 0.35})`,
          opacity: 1 - ring * 0.35,
        }}
      />

      <Img
        src={staticFile("logo.png")}
        style={{
          width: 148,
          height: 148,
          transform: `scale(${0.6 + Math.min(mark, 1) * 0.4}) rotate(${interpolate(mark, [0, 1], [-12, 0], { extrapolateRight: "clamp" })}deg)`,
          opacity: Math.min(mark, 1),
        }}
      />

      <div
        style={{
          marginTop: 34,
          fontFamily: fonts.display,
          fontSize: 72,
          color: colors.ink,
          opacity: Math.min(word, 1),
          transform: `translateY(${interpolate(word, [0, 1], [18, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        {copy.productName}
      </div>

      <div
        style={{
          marginTop: 16,
          fontSize: 28,
          fontWeight: 600,
          color: colors.muted,
          opacity: Math.min(tag, 1),
        }}
      >
        {copy.promise}
      </div>
    </AbsoluteFill>
  );
};
