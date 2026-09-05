import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

export const ProblemStatement = () => {
  const frame = useCurrentFrame();

  const intro = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, 16], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const holdFade = interpolate(frame, [SCENE.problem - 16, SCENE.problem - 2], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cascadeStart = 34;
  const copies = [0, 1, 2, 3, 4];

  return (
    <AbsoluteFill
      style={{
        background: colors.ruby,
        justifyContent: "center",
        paddingLeft: 160,
        fontFamily: fonts.display,
        color: colors.white,
      }}
    >
      <div
        style={{
          opacity: intro * holdFade,
          transform: `translateY(${rise}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            letterSpacing: 3.2,
            textTransform: "uppercase",
            fontSize: 18,
            opacity: 0.72,
            marginBottom: 22,
          }}
        >
          The bottleneck
        </div>
        <div style={{ fontSize: 76, lineHeight: 1.08, maxWidth: 1280 }}>
          {copy.problemLead}
        </div>
        <div style={{ position: "relative", height: 420, marginTop: 8 }}>
          <div style={{ fontSize: 92, lineHeight: 1, fontStyle: "italic" }}>
            {copy.problemKey}
          </div>
          {copies.map((index) => {
            const start = cascadeStart + index * 7;
            const y = interpolate(frame, [start, start + 30], [0, 78 + index * 64], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const opacity = interpolate(
              frame,
              [start, start + 6, start + 22, start + 38],
              [0, 0.42 - index * 0.06, 0.22, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (
              <div
                key={index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  fontSize: 92,
                  lineHeight: 1,
                  fontStyle: "italic",
                  opacity,
                  transform: `translateY(${y}px)`,
                }}
              >
                {copy.problemKey}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
