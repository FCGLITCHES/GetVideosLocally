import { interpolate } from "remotion";

export const sceneFadeOut = (
  frame: number,
  duration: number,
  fadeFrames = 12,
) =>
  interpolate(frame, [duration - fadeFrames, duration - 2], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const sceneFadeIn = (frame: number, fadeFrames = 14) =>
  interpolate(frame, [0, fadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
