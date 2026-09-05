import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { cameraAt, CameraViewport } from "../components/CameraViewport";
import { clickPulse, Cursor } from "../components/Cursor";
import {
  fadeIn,
  fadeOut,
  FieldHighlight,
  ProductScreenshot,
} from "../components/ProductScreenshot";
import { colors, fonts } from "../theme";
import { SCENE } from "../timings";

/**
 * Pic2.png @ 1680×920 — coordinates mapped from authentic UI.
 */
const URL_BOX = { left: 118, top: 292, width: 612, height: 46 };
const QUALITY_BOX = { left: 400, top: 368, width: 330, height: 46 };
const DOWNLOAD_BTN = { left: 118, top: 498, width: 612, height: 52 };

export const DownloadScene = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.download - 12, SCENE.download - 2);

  const heading = fadeIn(frame, 8, 22);
  const subheading = fadeIn(frame, 130, 148);

  const camera = cameraAt(frame, [
    { frame: 0, scale: 1, x: 0, y: 0 },
    { frame: 36, scale: 1.05, x: -20, y: -10 },
    { frame: 62, scale: 1.3, x: -60, y: -80 },
    { frame: 98, scale: 1.32, x: -80, y: -60 },
    { frame: 136, scale: 1.28, x: -70, y: -50 },
    { frame: 168, scale: 1.25, x: -50, y: -30 },
    { frame: 200, scale: 1.15, x: 40, y: -20 },
    { frame: 209, scale: 1.05, x: 0, y: 0 },
  ]);

  const showPic1 = frame >= 168;
  const qualityActive = interpolate(frame, [62, 78, 98], [0, 1, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const downloadActive = interpolate(frame, [136, 152], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(
    frame,
    [0, 30, 62, 98, 136, 168],
    [960, URL_BOX.left + 300, QUALITY_BOX.left + 160, QUALITY_BOX.left + 160, DOWNLOAD_BTN.left + 300, 1200],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const cursorY = interpolate(
    frame,
    [0, 30, 62, 98, 136, 168],
    [700, URL_BOX.top + 20, QUALITY_BOX.top + 20, QUALITY_BOX.top + 20, DOWNLOAD_BTN.top + 24, 500],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const click = Math.max(
    clickPulse(frame, 72),
    clickPulse(frame, 104),
    clickPulse(frame, 148),
  );
  const cursorOpacity = interpolate(frame, [168, 180], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const progress = interpolate(frame, [168, 200], [3.8, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

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
          left: 120,
          fontSize: 40,
          fontWeight: 780,
          letterSpacing: -1,
          color: colors.ink,
          opacity: heading * (1 - subheading),
        }}
      >
        Choose what you want.
      </div>
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 120,
          fontSize: 40,
          fontWeight: 780,
          letterSpacing: -1,
          color: colors.ink,
          opacity: subheading,
        }}
      >
        Download it locally.
      </div>

      <div style={{ marginTop: 30, position: "relative" }}>
        <CameraViewport
          scale={camera.scale}
          translateX={camera.x}
          translateY={camera.y}
        >
          {showPic1 ? (
            <ProductScreenshot
              src="Pic1.png"
              width={1680}
              height={920}
              scale={1.15}
              focusX={58}
              focusY={48}
              enter={false}
            >
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
                {progress.toFixed(1)}% at 136 Mbps
              </div>
            </ProductScreenshot>
          ) : (
            <ProductScreenshot
              src="Pic2.png"
              width={1680}
              height={920}
              scale={1}
              focusX={28}
              focusY={48}
              enter={false}
            >
              <FieldHighlight {...QUALITY_BOX} active={qualityActive} />
              <FieldHighlight {...DOWNLOAD_BTN} active={downloadActive} />
            </ProductScreenshot>
          )}
        </CameraViewport>

        <Cursor x={cursorX} y={cursorY} click={click} opacity={cursorOpacity} />
      </div>
    </AbsoluteFill>
  );
};
