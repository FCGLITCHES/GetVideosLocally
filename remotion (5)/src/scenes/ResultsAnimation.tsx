import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { ScreenshotFrame, fadeOut } from "../components/ScreenshotFrame";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

export const ResultsAnimation = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.results - 12, SCENE.results - 2);

  const progress = interpolate(frame, [18, 98], [3.8, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const speed = interpolate(frame, [18, 98], [136.85, 412], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const downloaded = Math.floor(
    interpolate(frame, [40, 120], [0, 8], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const needle = interpolate(frame, [20, 110], [-55, 48], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const textIn = interpolate(frame, [88, 108], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
          display: "flex",
          alignItems: "center",
          gap: 72,
          width: 1680,
        }}
      >
        <div style={{ position: "relative" }}>
          <ScreenshotFrame
            src="Pic1.png"
            width={980}
            height={640}
            scale={1.22}
            focusX={62}
            focusY={52}
            enter={false}
          />
          <div
            style={{
              position: "absolute",
              left: 548,
              top: 248,
              fontSize: 18,
              fontWeight: 800,
              color: colors.white,
              textShadow: "0 2px 8px rgba(0,0,0,.45)",
              zIndex: 15,
            }}
          >
            {progress.toFixed(1)}% at {speed.toFixed(0)} Mbps
          </div>
        </div>

        <div style={{ width: 520, color: colors.white }}>
          <div
            style={{
              width: 280,
              height: 280,
              borderRadius: 999,
              border: "3px solid rgba(255,255,255,.18)",
              position: "relative",
              marginBottom: 36,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 4,
                height: 108,
                marginLeft: -2,
                marginTop: -108,
                background: colors.rubyBright,
                transformOrigin: "50% 100%",
                transform: `rotate(${needle}deg)`,
                borderRadius: 4,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 18,
                height: 18,
                marginLeft: -9,
                marginTop: -9,
                borderRadius: 99,
                background: colors.white,
              }}
            />
          </div>

          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {downloaded}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "rgba(255,255,255,.55)",
              marginTop: 8,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            files kept locally
          </div>

          <div
            style={{
              marginTop: 32,
              fontFamily: fonts.display,
              fontSize: 48,
              lineHeight: 1.08,
              opacity: textIn,
              transform: `translateY(${interpolate(textIn, [0, 1], [20, 0])}px)`,
            }}
          >
            {copy.resultsSub}
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 24,
              color: "rgba(255,255,255,.72)",
              opacity: textIn,
            }}
          >
            {copy.resultsHeadline}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
