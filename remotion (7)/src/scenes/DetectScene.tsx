import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { cameraAt, CameraViewport } from "../components/CameraViewport";
import { clickPulse, Cursor } from "../components/Cursor";
import {
  fadeIn,
  fadeOut,
  ProductScreenshot,
} from "../components/ProductScreenshot";
import { colors, fonts } from "../theme";
import { SCENE } from "../timings";

const STATES: Array<{
  src: "Pic2.png" | "Pic1.png" | "Pic3.png" | "Pic4.png";
  start: number;
  end: number;
  focusX: number;
  focusY: number;
  scale: number;
}> = [
  { src: "Pic2.png", start: 0, end: 28, focusX: 28, focusY: 42, scale: 1.15 },
  { src: "Pic1.png", start: 28, end: 56, focusX: 28, focusY: 42, scale: 1.12 },
  { src: "Pic1.png", start: 56, end: 84, focusX: 62, focusY: 48, scale: 1.22 },
  { src: "Pic2.png", start: 84, end: 110, focusX: 28, focusY: 52, scale: 1.18 },
  { src: "Pic2.png", start: 110, end: 135, focusX: 28, focusY: 55, scale: 1.2 },
];

export const DetectScene = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.detect - 12, SCENE.detect - 2);

  const active =
    STATES.find((s) => frame >= s.start && frame < s.end) ?? STATES[STATES.length - 1]!;

  const camera = cameraAt(frame, [
    { frame: 0, scale: 1.05, x: 0, y: 0 },
    { frame: 36, scale: 1.08, x: -40, y: -20 },
    { frame: 72, scale: 1.1, x: 60, y: -10 },
    { frame: 110, scale: 1.12, x: -30, y: 20 },
    { frame: 134, scale: 1.1, x: 0, y: 0 },
  ]);

  const headline = fadeIn(frame, 100, 118);
  const pasted = interpolate(frame, [8, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(frame, [4, 20, 40], [900, 380, 380], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorY = interpolate(frame, [4, 20, 40], [600, 340, 340], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const click = clickPulse(frame, 16);

  return (
    <AbsoluteFill
      style={{
        background: colors.champagneSoft,
        fontFamily: fonts.sans,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 56,
          fontSize: 52,
          fontWeight: 780,
          letterSpacing: -1.5,
          color: colors.ink,
          opacity: headline,
        }}
      >
        Paste. Detect. Choose.
      </div>

      <div style={{ marginTop: 40, position: "relative" }}>
        <CameraViewport
          scale={camera.scale}
          translateX={camera.x}
          translateY={camera.y}
        >
          <ProductScreenshot
            src={active.src}
            width={1680}
            height={920}
            scale={active.scale}
            focusX={active.focusX}
            focusY={active.focusY}
            enter={false}
          />
          {pasted > 0.5 && frame < 30 ? (
            <div
              style={{
                position: "absolute",
                left: 118,
                top: 292,
                width: 612,
                height: 46,
                borderRadius: 10,
                border: `2px solid ${colors.ruby}`,
                boxShadow: "0 0 0 4px rgba(155,17,30,.12)",
                pointerEvents: "none",
              }}
            />
          ) : null}
        </CameraViewport>

        {frame < 50 ? (
          <Cursor x={cursorX} y={cursorY} click={click} />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
