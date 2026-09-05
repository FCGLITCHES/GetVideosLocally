import { interpolate } from "remotion";
import { colors } from "../theme";

type PointerProps = {
  x: number;
  y: number;
  click?: number;
  opacity?: number;
};

export const Pointer = ({ x, y, click = 0, opacity = 1 }: PointerProps) => {
  const press = interpolate(click, [0, 1], [1, 0.88]);
  const ring = interpolate(click, [0, 1], [12, 38]);
  const ringOpacity = interpolate(click, [0, 1], [0.45, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity,
        transform: `scale(${press})`,
        transformOrigin: "2px 2px",
        pointerEvents: "none",
        zIndex: 30,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -ring / 2 + 4,
          top: -ring / 2 + 6,
          width: ring,
          height: ring,
          borderRadius: "50%",
          border: `2px solid ${colors.ruby}`,
          opacity: ringOpacity,
        }}
      />
      <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
        <path
          d="M3 2.5L3 30.5L10.2 23.8L15.1 34.2L19.4 32.3L14.4 21.7H24.5L3 2.5Z"
          fill={colors.ink}
          stroke={colors.white}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
