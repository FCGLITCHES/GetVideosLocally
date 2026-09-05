import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { CameraViewport } from "../components/CameraViewport";
import { sceneFadeOut } from "../components/SceneFade";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

const CARD_SLOTS = [
  { left: 48, top: 248 },
  { left: 48, top: 398 },
  { left: 48, top: 548 },
  { left: 560, top: 248 },
  { left: 560, top: 398 },
  { left: 560, top: 548 },
];

export const LibraryBuild = () => {
  const frame = useCurrentFrame();
  const out = sceneFadeOut(frame, SCENE.library);

  const count = Math.min(
    6,
    Math.floor(
      interpolate(frame, [30, 120], [0, 6], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      }),
    ),
  );

  const totalGb = interpolate(frame, [40, 130], [0, 12.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const textIn = interpolate(frame, [100, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const pan = interpolate(frame, [0, SCENE.library], [0, -18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.dark,
        fontFamily: fonts.sans,
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 72,
          left: 120,
          zIndex: 20,
          color: colors.white,
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 780,
            letterSpacing: -1.2,
            lineHeight: 1.1,
            maxWidth: 700,
          }}
        >
          {copy.libraryHeadline}
        </div>
        <div
          style={{
            marginTop: 28,
            display: "flex",
            gap: 48,
            opacity: textIn,
            transform: `translateY(${interpolate(textIn, [0, 1], [16, 0])}px)`,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 64,
                fontWeight: 800,
                letterSpacing: -2,
                color: colors.champagne,
              }}
            >
              {count}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "rgba(255,255,255,.5)",
                textTransform: "uppercase",
                letterSpacing: 1.5,
              }}
            >
              {copy.libraryStat}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 64,
                fontWeight: 800,
                letterSpacing: -2,
                color: colors.green,
              }}
            >
              {totalGb.toFixed(1)} GB
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "rgba(255,255,255,.5)",
                textTransform: "uppercase",
                letterSpacing: 1.5,
              }}
            >
              kept offline
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: fonts.display,
            fontSize: 32,
            color: "rgba(255,255,255,.82)",
            opacity: textIn,
          }}
        >
          {copy.libraryBenefit}
        </div>
      </div>

      <CameraViewport
        translateX={pan}
        style={{ justifyContent: "flex-end", paddingRight: 80 }}
      >
        <div style={{ position: "relative" }}>
          <ScreenshotFrame
            src="Pic3.png"
            width={1100}
            height={780}
            scale={1.08}
            focusX={55}
            focusY={52}
            enter={false}
          />
          {CARD_SLOTS.map((slot, i) => {
            const cardIn = interpolate(
              frame,
              [24 + i * 14, 24 + i * 14 + 18],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            if (i >= count) return null;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: slot.left,
                  top: slot.top,
                  width: 480,
                  height: 130,
                  borderRadius: 12,
                  border: `2px solid rgba(0,184,148,${0.4 + cardIn * 0.4})`,
                  boxShadow: `0 0 0 ${4 + cardIn * 4}px rgba(0,184,148,${cardIn * 0.1})`,
                  pointerEvents: "none",
                  zIndex: 15,
                  opacity: cardIn * 0.85,
                }}
              />
            );
          })}
        </div>
      </CameraViewport>
    </AbsoluteFill>
  );
};
