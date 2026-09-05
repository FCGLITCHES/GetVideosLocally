import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import {
  BrowserFrame,
  BrowserVideoPlaceholder,
  fadeOut,
} from "../components/BrowserFrame";
import { clickPulse, Cursor } from "../components/Cursor";
import { ProductScreenshot } from "../components/ProductScreenshot";
import { colors, copy, fonts } from "../theme";
import { SCENE } from "../timings";

export const LinkScene = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.link - 12, SCENE.link - 2);

  const browserEnter = interpolate(frame, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const browserScale = interpolate(browserEnter, [0, 1], [1.05, 1]);
  const urlSelected = interpolate(frame, [48, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const copied = interpolate(frame, [62, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const handoff = interpolate(frame, [78, 108], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const headline = interpolate(frame, [8, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const copyHint = interpolate(frame, [36, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(
    frame,
    [20, 44, 78, 100],
    [1100, 620, 620, 1040],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const cursorY = interpolate(
    frame,
    [20, 44, 78, 100],
    [200, 72, 72, 420],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const click = Math.max(clickPulse(frame, 52), clickPulse(frame, 96));

  const pillX = interpolate(handoff, [0, 1], [620, 1040]);
  const pillOpacity = interpolate(handoff, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);

  return (
    <AbsoluteFill
      style={{
        background: colors.champagneSoft,
        fontFamily: fonts.sans,
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 36,
          fontWeight: 700,
          color: colors.ink,
          opacity: headline,
        }}
      >
        Found something worth keeping?
      </div>
      <div
        style={{
          position: "absolute",
          top: 112,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 22,
          fontWeight: 600,
          color: colors.muted,
          opacity: copyHint,
        }}
      >
        Copy the link.
      </div>

      <div
        style={{
          position: "absolute",
          left: 120,
          top: 200,
          opacity: interpolate(handoff, [0, 1], [1, 0]),
          transform: `translateX(${interpolate(handoff, [0, 1], [0, -120])}px) scale(${browserScale})`,
        }}
      >
        <BrowserFrame url={copy.demoUrl} width={860} height={500}>
          <BrowserVideoPlaceholder selected={urlSelected} />
        </BrowserFrame>
        {copied > 0.5 ? (
          <div
            style={{
              position: "absolute",
              top: 48,
              right: 40,
              background: colors.ink,
              color: colors.white,
              borderRadius: 999,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 700,
              opacity: copied * (1 - handoff),
            }}
          >
            Ctrl + C
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          right: 80,
          top: 160,
          opacity: handoff,
          transform: `translateX(${interpolate(handoff, [0, 1], [80, 0])}px)`,
        }}
      >
        <ProductScreenshot
          src="Pic2.png"
          width={1000}
          height={640}
          scale={1}
          focusX={50}
          focusY={50}
          enter={false}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: pillX,
          top: 340,
          background: colors.ruby,
          color: colors.white,
          borderRadius: 999,
          padding: "10px 18px",
          fontSize: 14,
          fontWeight: 700,
          opacity: pillOpacity,
          boxShadow: "0 8px 24px rgba(155,17,30,.28)",
        }}
      >
        {copy.demoUrl}
      </div>

      <Cursor
        x={cursorX}
        y={cursorY}
        click={click}
        opacity={interpolate(handoff, [0.85, 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
      />
    </AbsoluteFill>
  );
};
