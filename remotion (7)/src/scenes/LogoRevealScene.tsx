import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fadeOut } from "../components/ProductScreenshot";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

export const LogoRevealScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = fadeOut(frame, SCENE.logoReveal - 10, SCENE.logoReveal - 2);

  const reveal = interpolate(frame, [0, 30], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logo = spring({
    frame: frame - 8,
    fps,
    config: { damping: 18, stiffness: 100 },
  });
  const tag = interpolate(frame, [24, 38], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const maskOpen = interpolate(frame, [52, 72], [0, 1], {
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
          width: 520,
          height: 320,
          borderRadius: 18,
          background: colors.champagneSoft,
          transform: `scale(${0.6 + maskOpen * 0.5})`,
          opacity: maskOpen * 0.4,
        }}
      />

      <div
        style={{
          overflow: "hidden",
          clipPath: `inset(0 ${100 - reveal}% 0 0)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `scale(${0.94 + Math.min(logo, 1) * 0.06})`,
          opacity: Math.min(logo, 1),
        }}
      >
        <Img
          src={staticFile("logo.png")}
          style={{ width: 148, height: 148 }}
        />
        <div
          style={{
            marginTop: 34,
            fontFamily: fonts.display,
            fontSize: 72,
            color: colors.ink,
            letterSpacing: -1,
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
            opacity: tag,
          }}
        >
          Your video. Your file.
        </div>
      </div>
    </AbsoluteFill>
  );
};
