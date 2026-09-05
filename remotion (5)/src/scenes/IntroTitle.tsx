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
import { SCENE } from "../timings";

export const IntroTitle = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const line1 = interpolate(frame, [8, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line2 = interpolate(frame, [22, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const toGradient = interpolate(frame, [58, 82], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logo = spring({
    frame: frame - 72,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const out = interpolate(
    frame,
    [SCENE.intro - 14, SCENE.intro - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const bg =
    toGradient < 0.5
      ? colors.paper
      : `linear-gradient(135deg, ${colors.gradientStart} 0%, ${colors.ruby} 100%)`;

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
          opacity: 1 - toGradient,
          transform: `translateY(${interpolate(line1, [0, 1], [24, 0])}px)`,
          textAlign: "center",
          color: colors.ink,
          width: 1400,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -2,
            opacity: line1,
          }}
        >
          {copy.introLine1}
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: -2.5,
            marginTop: 16,
            color: colors.ruby,
            opacity: line2,
          }}
        >
          {copy.introLine2}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: toGradient * Math.min(logo, 1),
          transform: `scale(${0.88 + Math.min(logo, 1) * 0.12})`,
        }}
      >
        <Img
          src={staticFile("logo.png")}
          style={{ width: 132, height: 132, marginBottom: 28 }}
        />
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 78,
            color: colors.white,
            letterSpacing: -1,
          }}
        >
          {copy.productName}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 28,
            fontWeight: 600,
            color: "rgba(255,255,255,.88)",
          }}
        >
          {copy.promise}
        </div>
      </div>
    </AbsoluteFill>
  );
};
