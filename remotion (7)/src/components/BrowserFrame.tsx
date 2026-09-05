import type { ReactNode } from "react";
import { interpolate } from "remotion";
import { colors } from "../theme";

type BrowserFrameProps = {
  children: ReactNode;
  width?: number;
  height?: number;
  url?: string;
  opacity?: number;
  scale?: number;
  translateX?: number;
};

export const BrowserFrame = ({
  children,
  width = 900,
  height = 560,
  url = "https://example.com/video/clip",
  opacity = 1,
  scale = 1,
  translateX = 0,
}: BrowserFrameProps) => (
  <div
    style={{
      width,
      opacity,
      transform: `translateX(${translateX}px) scale(${scale})`,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 28px 80px rgba(0,0,0,.16)",
      border: `1px solid ${colors.border}`,
      background: colors.white,
    }}
  >
    <div
      style={{
        height: 42,
        background: "#eceef2",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 8,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div
            key={c}
            style={{ width: 11, height: 11, borderRadius: 99, background: c }}
          />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          marginLeft: 8,
          background: colors.white,
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 13,
          color: colors.muted,
          fontFamily: "Manrope",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {url}
      </div>
    </div>
    <div style={{ height: height - 42, background: colors.paper }}>{children}</div>
  </div>
);

export const BrowserVideoPlaceholder = ({ selected = 0 }: { selected?: number }) => (
  <div style={{ padding: 28, fontFamily: "Manrope", position: "relative" }}>
    <div
      style={{
        width: "100%",
        height: 280,
        borderRadius: 12,
        background: "linear-gradient(135deg, #1a1a2e 0%, #2d2d44 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 99,
          background: "rgba(255,255,255,.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderTop: "14px solid transparent",
            borderBottom: "14px solid transparent",
            borderLeft: "22px solid white",
            marginLeft: 6,
          }}
        />
      </div>
    </div>
    <div style={{ marginTop: 18, fontSize: 22, fontWeight: 700, color: colors.ink }}>
      Video worth keeping
    </div>
    <div style={{ marginTop: 6, fontSize: 15, color: colors.muted }}>
      Found something you want offline?
    </div>
    {selected > 0.5 ? (
      <div
        style={{
          position: "absolute",
          top: 52,
          left: 14,
          right: 14,
          background: "rgba(155,17,30,.12)",
          border: `2px solid ${colors.ruby}`,
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          color: colors.ink,
          fontWeight: 600,
        }}
      >
        {url}
      </div>
    ) : null}
  </div>
);

const url = "https://example.com/video/clip";

export const fadeIn = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const fadeOut = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
