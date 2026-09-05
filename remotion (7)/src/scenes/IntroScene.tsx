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

export const IntroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const line1 = interpolate(frame, [8, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line1Y = interpolate(line1, [0, 1], [20, 0]);

  const behindFade = interpolate(frame, [42, 52], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const keepLocal = interpolate(frame, [44, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const keepLocalY = interpolate(keepLocal, [0, 1], [24, 0]);

  const toGradient = interpolate(frame, [72, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logo = spring({
    frame: frame - 82,
    fps,
    config: { damping: 18, stiffness: 100 },
  });
  const tagline = interpolate(frame, [92, 104], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cameraPush = interpolate(frame, [100, 118], [1, 1.02], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = fadeOut(frame, SCENE.intro - 14, SCENE.intro - 2);

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
        transform: `scale(${cameraPush})`,
      }}
    >
      <div
        style={{
          opacity: (1 - toGradient) * line1,
          transform: `translateY(${line1Y}px)`,
          textAlign: "center",
          color: colors.ink,
          width: 1400,
          position: "absolute",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>
          Videos shouldn&apos;t disappear
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2, marginTop: 8 }}>
          <span style={{ opacity: behindFade }}>behind a link</span>
          <span>.</span>
        </div>
      </div>

      <div
        style={{
          opacity: (1 - toGradient) * keepLocal,
          transform: `translateY(${keepLocalY}px) scale(${0.96 + keepLocal * 0.04})`,
          textAlign: "center",
          color: colors.ruby,
          fontSize: 88,
          fontWeight: 800,
          letterSpacing: -3,
          position: "absolute",
        }}
      >
        Keep them locally.
      </div>

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: toGradient * Math.min(logo, 1),
          transform: `scale(${0.94 + Math.min(logo, 1) * 0.06})`,
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
            fontSize: 26,
            fontWeight: 600,
            color: "rgba(255,255,255,.88)",
            opacity: tagline,
          }}
        >
          {copy.tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
