import { Img, staticFile } from "remotion";
import { colors, copy, fonts } from "../theme";

type BrandLogoProps = {
  size?: number;
  showName?: boolean;
  showTagline?: boolean;
  tagline?: string;
  nameColor?: string;
  taglineColor?: string;
  opacity?: number;
  scale?: number;
};

export const BrandLogo = ({
  size = 132,
  showName = true,
  showTagline = false,
  tagline = "Download what you need. Keep what you download.",
  nameColor = colors.white,
  taglineColor = "rgba(255,255,255,.88)",
  opacity = 1,
  scale = 1,
}: BrandLogoProps) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      opacity,
      transform: `scale(${scale})`,
    }}
  >
    <Img
      src={staticFile("logo.png")}
      style={{ width: size, height: size, marginBottom: showName ? 28 : 0 }}
    />
    {showName ? (
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: size * 0.59,
          color: nameColor,
          letterSpacing: -1,
        }}
      >
        {copy.productName}
      </div>
    ) : null}
    {showTagline ? (
      <div
        style={{
          marginTop: 14,
          fontSize: 28,
          fontWeight: 600,
          color: taglineColor,
          textAlign: "center",
          maxWidth: 720,
        }}
      >
        {tagline}
      </div>
    ) : null}
  </div>
);
