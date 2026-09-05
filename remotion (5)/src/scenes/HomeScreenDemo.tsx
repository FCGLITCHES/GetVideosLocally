import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Pointer } from "../components/Pointer";
import {
  FieldHighlight,
  ScreenshotFrame,
  TypedOverlay,
  fadeOut,
} from "../components/ScreenshotFrame";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

/**
 * Pic2.png @ 1920×1080 — coordinates mapped to 1680×920 frame, scale 1.0.
 * URL field ≈ (118, 292, 612×46), Download Now ≈ (118, 498, 612×52).
 */
const URL_BOX = { left: 118, top: 292, width: 612, height: 46 };
const DOWNLOAD_BTN = { left: 118, top: 498, width: 612, height: 52 };

export const HomeScreenDemo = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.homeScreen - 12, SCENE.homeScreen - 2);

  const chars = Math.floor(
    interpolate(frame, [38, 108], [0, copy.demoUrl.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const fieldActive = interpolate(frame, [24, 40, 118, 132], [0, 1, 1, 0.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const btnActive = interpolate(frame, [118, 140], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const clickField = interpolate(frame, [108, 114, 122], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const clickBtn = interpolate(frame, [148, 154, 162], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(
    frame,
    [0, 28, 118, 148],
    [960, URL_BOX.left + 420, URL_BOX.left + 420, DOWNLOAD_BTN.left + 300],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );
  const cursorY = interpolate(
    frame,
    [0, 28, 118, 148],
    [700, URL_BOX.top + 18, URL_BOX.top + 18, DOWNLOAD_BTN.top + 24],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );

  const zoom = interpolate(frame, [0, 30], [1.03, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
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
          top: 72,
          left: 120,
          fontSize: 52,
          fontWeight: 780,
          letterSpacing: -1.5,
          color: colors.ink,
        }}
      >
        One link. No account maze.
      </div>

      <div
        style={{
          transform: `scale(${zoom})`,
          marginTop: 40,
          position: "relative",
        }}
      >
        <ScreenshotFrame
          src="Pic2.png"
          width={1680}
          height={920}
          scale={1}
          focusX={50}
          focusY={48}
          enter
        >
          <FieldHighlight {...URL_BOX} active={fieldActive} />
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
        </ScreenshotFrame>

        <Pointer
          x={cursorX}
          y={cursorY}
          click={Math.max(clickField, clickBtn)}
        />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 58,
          fontSize: 26,
          fontWeight: 600,
          color: colors.muted,
        }}
      >
        Paste a video URL, pick quality, and download locally.
      </div>
    </AbsoluteFill>
  );
};
