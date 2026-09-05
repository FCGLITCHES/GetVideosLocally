import { interpolate } from "remotion";
import { colors } from "../theme";

type ClickPulseProps = {
  x: number;
  y: number;
  click?: number;
};

export const ClickPulse = ({ x, y, click = 0 }: ClickPulseProps) => {
  const ring = interpolate(click, [0, 1], [8, 28]);
  const ringOpacity = interpolate(click, [0, 1], [0.5, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: ring,
        height: ring,
        marginLeft: -ring / 2,
        marginTop: -ring / 2,
        borderRadius: "50%",
        border: `2px solid ${colors.ruby}`,
        opacity: ringOpacity,
        pointerEvents: "none",
        zIndex: 25,
      }}
    />
  );
};
