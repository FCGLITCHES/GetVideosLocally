import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrandLogo } from "../components/BrandLogo";
import { sceneFadeIn } from "../components/SceneFade";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { colors, copy, fonts } from "../theme";

export const OutroPanel = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const kenBurns = interpolate(frame, [0, 60], [1.06, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const uiOut = interpolate(frame, [0, 32], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panelIn = spring({
    frame: frame - 28,
    fps,
    config: { damping: 16, stiffness: 100 },
  });

  return (
    <AbsoluteFill style={{ fontFamily: fonts.sans, background: colors.dark }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: uiOut,
        }}
      >
        <div style={{ transform: `scale(${kenBurns})` }}>
          <ScreenshotFrame
            src="Pic4.png"
            width={1920}
            height={1080}
            scale={1}
            focusX={50}
            focusY={50}
            radius={0}
            enter={false}
          />
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(13,17,23,.92) 0%, rgba(13,17,23,.72) 42%, transparent 100%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 120,
          top: "50%",
          transform: `translateY(-50%) translateX(${interpolate(panelIn, [0, 1], [-40, 0], { extrapolateRight: "clamp" })}px)`,
          opacity: Math.min(panelIn, 1),
          width: 620,
        }}
      >
        <BrandLogo
          size={96}
          showName
          showTagline
          tagline={copy.promise}
          nameColor={colors.white}
          taglineColor="rgba(255,255,255,.8)"
        />
        <div
          style={{
            marginTop: 36,
            display: "inline-block",
            background: colors.ruby,
            color: colors.white,
            borderRadius: 14,
            padding: "18px 36px",
            fontSize: 24,
            fontWeight: 800,
            boxShadow: "0 20px 50px rgba(155,17,30,.35)",
          }}
        >
          {copy.cta}
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 22,
            fontWeight: 700,
            color: colors.champagne,
            opacity: sceneFadeIn(frame, 50),
          }}
        >
          {copy.url}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 16,
            color: "rgba(255,255,255,.55)",
            opacity: sceneFadeIn(frame, 58),
          }}
        >
          {copy.footer}
        </div>
      </div>

      <Img
        src={staticFile("logo.png")}
        style={{
          position: "absolute",
          right: 120,
          bottom: 80,
          width: 72,
          height: 72,
          opacity: sceneFadeIn(frame, 40) * 0.35,
        }}
      />
    </AbsoluteFill>
  );
};
