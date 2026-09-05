import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { sceneFadeOut } from "../components/SceneFade";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

export const HookCascade = () => {
  const frame = useCurrentFrame();
  const out = sceneFadeOut(frame, SCENE.hook);

  const intro = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, 18], [22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cascadeStart = 36;
  const copies = [0, 1, 2, 3];

  return (
    <AbsoluteFill
      style={{
        background: colors.ruby,
        justifyContent: "center",
        paddingLeft: 140,
        fontFamily: fonts.display,
        color: colors.white,
        opacity: out,
      }}
    >
      <div style={{ opacity: intro, transform: `translateY(${rise}px)` }}>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
            fontSize: 17,
            opacity: 0.7,
            marginBottom: 20,
          }}
        >
          GetVideosLocally
        </div>
        <div style={{ fontSize: 72, lineHeight: 1.1, maxWidth: 1200 }}>
          {copy.hookLead}
        </div>
        <div style={{ position: "relative", height: 360, marginTop: 12 }}>
          <div style={{ fontSize: 88, lineHeight: 1, fontStyle: "italic" }}>
            {copy.hookKey}
          </div>
          {copies.map((index) => {
            const start = cascadeStart + index * 8;
            const y = interpolate(
              frame,
              [start, start + 28],
              [0, 70 + index * 58],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const opacity = interpolate(
              frame,
              [start, start + 6, start + 20, start + 34],
              [0, 0.38 - index * 0.07, 0.18, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (
              <div
                key={index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  fontSize: 88,
                  lineHeight: 1,
                  fontStyle: "italic",
                  opacity,
                  transform: `translateY(${y}px)`,
                }}
              >
                {copy.hookKey}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
