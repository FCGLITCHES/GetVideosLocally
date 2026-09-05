import type { CSSProperties, ReactNode } from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

export type ScreenshotSrc = "Pic1.png" | "Pic2.png" | "Pic3.png" | "Pic4.png";

type ProductScreenshotProps = {
  src: ScreenshotSrc;
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
export const ProductScreenshot = ({
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
}: ProductScreenshotProps) => {
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
