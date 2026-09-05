import type { CSSProperties, ReactNode } from "react";

type CameraViewportProps = {
  scale?: number;
  translateX?: number;
  translateY?: number;
  children: ReactNode;
  style?: CSSProperties;
};

export const CameraViewport = ({
  scale = 1,
  translateX = 0,
  translateY = 0,
  children,
  style,
}: CameraViewportProps) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transformOrigin: "center center",
        willChange: "transform",
      }}
    >
      {children}
    </div>
  </div>
);
