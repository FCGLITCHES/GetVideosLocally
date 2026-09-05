import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { CameraViewport } from "../components/CameraViewport";
import { Cursor } from "../components/Cursor";
import { sceneFadeOut } from "../components/SceneFade";
import {
  FieldHighlight,
  ScreenshotFrame,
  TypedOverlay,
} from "../components/ScreenshotFrame";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

/** Pic2.png — dark empty state, quality-first workflow */
const URL_BOX = { left: 118, top: 292, width: 612, height: 46 };
const QUALITY_BOX = { left: 380, top: 398, width: 302, height: 46 };
const DOWNLOAD_BTN = { left: 118, top: 498, width: 612, height: 52 };

export const PasteAndPick = () => {
  const frame = useCurrentFrame();
  const out = sceneFadeOut(frame, SCENE.workflow);

  const chars = Math.floor(
    interpolate(frame, [24, 88], [0, copy.demoUrl.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const urlActive = interpolate(frame, [16, 32, 96, 108], [0, 1, 1, 0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const qualityActive = interpolate(frame, [96, 118, 158], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const btnActive = interpolate(frame, [158, 175], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const clickQuality = interpolate(frame, [118, 124, 132], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const clickBtn = interpolate(frame, [168, 174, 182], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(
    frame,
    [0, 24, 96, 118, 158],
    [960, URL_BOX.left + 400, URL_BOX.left + 400, QUALITY_BOX.left + 150, DOWNLOAD_BTN.left + 280],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );
  const cursorY = interpolate(
    frame,
    [0, 24, 96, 118, 158],
    [680, URL_BOX.top + 18, URL_BOX.top + 18, QUALITY_BOX.top + 20, DOWNLOAD_BTN.top + 24],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );

  const zoom = interpolate(frame, [0, 28], [1.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.ink,
        fontFamily: fonts.sans,
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 64,
          left: 120,
          fontSize: 44,
          fontWeight: 780,
          letterSpacing: -1,
          color: colors.white,
          maxWidth: 900,
          lineHeight: 1.15,
        }}
      >
        {copy.workflowHeadline}
      </div>

      <CameraViewport scale={zoom} style={{ marginTop: 48 }}>
        <div style={{ position: "relative" }}>
          <ScreenshotFrame
            src="Pic2.png"
            width={1640}
            height={880}
            scale={1}
            focusX={50}
            focusY={46}
            enter
          >
            <FieldHighlight {...URL_BOX} active={urlActive} />
            <FieldHighlight {...QUALITY_BOX} active={qualityActive} />
            <FieldHighlight {...DOWNLOAD_BTN} active={btnActive} />
            {chars > 0 ? (
              <TypedOverlay
                {...URL_BOX}
                text={copy.demoUrl}
                charCount={chars}
                fontSize={17}
                dark
              />
            ) : null}
            {qualityActive > 0.5 ? (
              <div
                style={{
                  position: "absolute",
                  left: QUALITY_BOX.left,
                  top: QUALITY_BOX.top,
                  width: QUALITY_BOX.width,
                  height: QUALITY_BOX.height,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 14px",
                  boxSizing: "border-box",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#f5f5f5",
                  zIndex: 12,
                  pointerEvents: "none",
                }}
              >
                {copy.qualityLabel}
              </div>
            ) : null}
          </ScreenshotFrame>
          <Cursor
            x={cursorX}
            y={cursorY}
            click={Math.max(clickQuality, clickBtn)}
          />
        </div>
      </CameraViewport>
    </AbsoluteFill>
  );
};
