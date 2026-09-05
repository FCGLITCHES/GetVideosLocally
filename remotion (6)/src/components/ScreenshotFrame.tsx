import type { CSSProperties, ReactNode } from "react";
import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors } from "../theme";

type ScreenshotFrameProps = {
  src: "Pic1.png" | "Pic2.png" | "Pic3.png" | "Pic4.png";
  width?: number;
  height?: number;
  scale?: number;
  focusX?: number;
  focusY?: number;
  radius?: number;
  enter?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
};

/** Authentic screenshot crop — image is enlarged and offset, never redrawn. */
export const ScreenshotFrame = ({
  src,
  width = 1680,
  height = 920,
  scale = 1,
  focusX = 50,
  focusY = 50,
  radius = 22,
  enter = true,
  style,
  children,
}: ScreenshotFrameProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = enter
    ? spring({ frame, fps, config: { damping: 18, stiffness: 105, mass: 0.85 } })
    : 1;

  return (
    <div
      style={{
        width,
        height,
        overflow: "hidden",
        borderRadius: radius,
        background: colors.cream,
        boxShadow: "0 28px 90px rgba(0,0,0,.18)",
        transform: `translateY(${(1 - rise) * 36}px) scale(${0.97 + rise * 0.03})`,
        opacity: rise,
        position: "relative",
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          width: `${100 * scale}%`,
          height: "auto",
          left: `${-(focusX * (scale - 1))}%`,
          top: `${-(focusY * (scale - 1))}%`,
        }}
      />
      {children}
    </div>
  );
};

type FieldHighlightProps = {
  left: number;
  top: number;
  width: number;
  height: number;
  active?: number;
};

/** Ring highlight on a real control — does not replace the UI underneath. */
export const FieldHighlight = ({
  left,
  top,
  width,
  height,
  active = 0,
}: FieldHighlightProps) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width,
      height,
      borderRadius: 10,
      boxSizing: "border-box",
      border: `2px solid rgba(155,17,30,${0.35 + active * 0.55})`,
      boxShadow: `0 0 0 ${4 + active * 4}px rgba(155,17,30,${active * 0.12})`,
      pointerEvents: "none",
      zIndex: 10,
    }}
  />
);

type TypedOverlayProps = {
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
  charCount: number;
  fontSize?: number;
  dark?: boolean;
};

/** Types into the real input region without drawing a substitute field. */
export const TypedOverlay = ({
  left,
  top,
  width,
  height,
  text,
  charCount,
  fontSize = 17,
  dark = true,
}: TypedOverlayProps) => {
  const frame = useCurrentFrame();
  const caret = Math.floor(frame / 10) % 2 === 0;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        boxSizing: "border-box",
        fontFamily: "Manrope, sans-serif",
        fontSize,
        fontWeight: 500,
        color: dark ? "#f5f5f5" : colors.ink,
        zIndex: 12,
        pointerEvents: "none",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {text.slice(0, charCount)}
      {charCount < text.length || caret ? (
        <span
          style={{
            display: "inline-block",
            width: 2,
            height: fontSize + 4,
            background: colors.ruby,
            marginLeft: 1,
            opacity: caret ? 1 : 0,
          }}
        />
      ) : null}
    </div>
  );
};

export const fadeOut = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const fadeIn = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
