import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { colors, copy, fonts } from "../theme";

type Phase = "queued" | "downloading" | "saved";

export const SavedStatus = () => {
  const frame = useCurrentFrame();

  const phase: Phase =
    frame < 32 ? "queued" : frame < 78 ? "downloading" : "saved";

  const progress = interpolate(frame, [32, 78], [0.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const boxColor =
    phase === "queued"
      ? "#ececec"
      : phase === "downloading"
        ? colors.ruby
        : colors.success;
  const boxText = phase === "queued" ? colors.ink : colors.white;
  const label =
    phase === "queued"
      ? copy.queued
      : phase === "downloading"
        ? copy.downloading
        : copy.saved;

  const benefitIn = interpolate(frame, [70, 88], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const kenBurns = interpolate(frame, [0, 126], [1.08, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.dark, fontFamily: fonts.sans }}>
      <AbsoluteFill>
        <Img
          src={staticFile("Pic4.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${kenBurns})`,
            opacity: 0.46,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(17,17,17,0.78) 0%, rgba(17,17,17,0.5) 48%, rgba(17,17,17,0.22) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "0 120px",
          gap: 80,
        }}
      >
        <div
          style={{
            width: 430,
            borderRadius: 22,
            background: boxColor,
            color: boxText,
            padding: "42px 40px",
            boxShadow: "0 24px 50px rgba(0,0,0,0.25)",
          }}
        >
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 64,
              lineHeight: 0.95,
            }}
          >
            {label}
          </div>
          <div
            style={{
              marginTop: 22,
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: 0.4,
            }}
          >
            {copy.badgeEightK}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: 0.4,
            }}
          >
            {copy.badgeLocal}
          </div>
          <div
            style={{
              marginTop: 28,
              height: 8,
              borderRadius: 99,
              background: phase === "queued" ? "#d8d8d8" : "rgba(255,255,255,0.28)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: "100%",
                background: phase === "saved" ? colors.white : colors.champagne,
              }}
            />
          </div>
        </div>

        <div
          style={{
            opacity: benefitIn,
            transform: `translateX(${interpolate(benefitIn, [0, 1], [24, 0])}px)`,
            color: colors.white,
            maxWidth: 720,
          }}
        >
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 700,
              letterSpacing: 2.6,
              textTransform: "uppercase",
              fontSize: 16,
              color: colors.champagne,
              marginBottom: 16,
            }}
          >
            The outcome
          </div>
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 72,
              lineHeight: 1.05,
            }}
          >
            {copy.benefit}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
