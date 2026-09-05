import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fadeIn, ProductScreenshot } from "../components/ProductScreenshot";
import { colors, copy, fonts } from "../theme";

export const OutroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const uiOut = interpolate(frame, [0, 28], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const uiScale = interpolate(frame, [0, 28], [1, 0.96], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const gradientIn = interpolate(frame, [18, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headline = fadeIn(frame, 30, 48);
  const logo = spring({
    frame: frame - 48,
    fps,
    config: { damping: 16, stiffness: 100 },
  });
  const headlineShift = interpolate(frame, [48, 62], [0, -20], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const button = spring({
    frame: frame - 72,
    fps,
    config: { damping: 15, stiffness: 120 },
  });
  const url = fadeIn(frame, 88, 104);
  const footer = fadeIn(frame, 96, 112);

  return (
    <AbsoluteFill style={{ fontFamily: fonts.sans }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: uiOut,
          transform: `scale(${uiScale})`,
        }}
      >
        <ProductScreenshot
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
        <div
          style={{
            transform: `translateY(${headlineShift}px)`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: colors.white,
              opacity: headline,
              marginBottom: 32,
              letterSpacing: -1,
            }}
          >
            Keep the videos you care about.
          </div>

          <Img
            src={staticFile("logo.png")}
            style={{
              width: 120,
              height: 120,
              opacity: Math.min(logo, 1),
              transform: `scale(${0.85 + Math.min(logo, 1) * 0.15})`,
            }}
          />
          <div
            style={{
              marginTop: 24,
              fontFamily: fonts.display,
              fontSize: 64,
              color: colors.white,
              letterSpacing: -1,
              opacity: Math.min(logo, 1),
            }}
          >
            {copy.productName}
          </div>
        </div>

        <div
          style={{
            marginTop: 36,
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
            opacity: footer,
          }}
        >
          {copy.footer}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
