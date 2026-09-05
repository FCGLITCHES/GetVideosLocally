import { interpolate } from "remotion";
import { ClickPulse } from "./ClickPulse";
import { colors } from "../theme";

type CursorProps = {
  x: number;
  y: number;
  click?: number;
  opacity?: number;
  scale?: number;
};

export const Cursor = ({
  x,
  y,
  click = 0,
  opacity = 1,
  scale = 1,
}: CursorProps) => {
  const press = interpolate(click, [0, 1], [1, 0.88]);

  return (
    <>
      <ClickPulse x={x + 4} y={y + 6} click={click} />
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          opacity,
          transform: `scale(${press * scale})`,
          transformOrigin: "2px 2px",
          pointerEvents: "none",
          zIndex: 30,
        }}
      >
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
    </>
  );
};
