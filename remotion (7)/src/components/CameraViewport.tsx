import type { ReactNode } from "react";
import { Easing, interpolate } from "remotion";

type CameraViewportProps = {
  children: ReactNode;
  scale?: number;
  translateX?: number;
  translateY?: number;
  width?: number;
  height?: number;
};

export const CameraViewport = ({
  children,
  scale = 1,
  translateX = 0,
  translateY = 0,
  width = 1680,
  height = 920,
}: CameraViewportProps) => (
  <div
    style={{
      width,
      height,
      overflow: "hidden",
      position: "relative",
    }}
  >
    <div
      style={{
        width: "100%",
        height: "100%",
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </div>
  </div>
);

export const cameraEase = Easing.inOut(Easing.cubic);

export const cameraAt = (
  frame: number,
  keyframes: Array<{ frame: number; scale: number; x: number; y: number }>,
) => {
  const scales = keyframes.map((k) => k.scale);
  const xs = keyframes.map((k) => k.x);
  const ys = keyframes.map((k) => k.y);
  const frames = keyframes.map((k) => k.frame);

  return {
    scale: interpolate(frame, frames, scales, {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: cameraEase,
    }),
    x: interpolate(frame, frames, xs, {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: cameraEase,
    }),
    y: interpolate(frame, frames, ys, {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: cameraEase,
    }),
  };
};
