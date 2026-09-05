import type { ReactNode } from "react";
import { Img, staticFile } from "remotion";
import { colors, copy, fonts } from "../theme";

type ProductWindowProps = {
  children: ReactNode;
  theme?: "light" | "dark";
  queued?: number;
  downloading?: number;
  downloaded?: number;
  width?: number;
  scale?: number;
};

export const ProductWindow = ({
  children,
  theme = "light",
  queued = 0,
  downloading = 0,
  downloaded = 0,
  width = 1480,
  scale = 1,
}: ProductWindowProps) => {
  const isDark = theme === "dark";
  const shell = isDark ? colors.dark : "#f3f3f3";
  const nav = isDark ? "#161616" : "#f7f7f7";
  const body = isDark ? "#1a1a1a" : colors.cream;
  const text = isDark ? "#f5f5f5" : "#3a3a3a";

  return (
    <div
      style={{
        width,
        transform: `scale(${scale})`,
        transformOrigin: "top center",
        background: body,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 28px 80px rgba(17, 17, 17, 0.28)",
        fontFamily: fonts.sans,
      }}
    >
      <div
        style={{
          height: 22,
          background: shell,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 6,
        }}
      >
        <span style={dot("#ff5f57")} />
        <span style={dot("#febc2e")} />
        <span style={dot("#28c840")} />
      </div>
      <div
        style={{
          height: 72,
          background: `linear-gradient(to right, ${colors.ruby}, ${colors.rubyDeep})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 22px",
          color: colors.white,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Img src={staticFile("logo.png")} style={{ width: 36, height: 36 }} />
          <span
            style={{
              fontFamily: fonts.sans,
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: -0.4,
            }}
          >
            {copy.productName}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 13, fontWeight: 600 }}>
          <Stat label="Queued" value={queued} />
          <Stat label="Downloading" value={downloading} />
          <Stat label="Downloaded" value={downloaded} />
        </div>
      </div>
      <div
        style={{
          height: 48,
          background: nav,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          color: text,
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        <span style={{ color: colors.ruby, borderBottom: `2px solid ${colors.ruby}`, paddingBottom: 6 }}>
          Downloads
        </span>
        <span style={{ opacity: 0.55 }}>History</span>
      </div>
      {children}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div
    style={{
      display: "flex",
      gap: 6,
      alignItems: "center",
      background: "rgba(255,255,255,0.12)",
      borderRadius: 8,
      padding: "6px 10px",
    }}
  >
    <span style={{ opacity: 0.85 }}>{label}:</span>
    <span>{value}</span>
  </div>
);

const dot = (background: string) => ({
  width: 10,
  height: 10,
  borderRadius: 10,
  background,
});
