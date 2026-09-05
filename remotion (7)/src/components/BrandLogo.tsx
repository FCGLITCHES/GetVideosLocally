import { Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

type BrandLogoProps = {
  size?: number;
  showName?: boolean;
  showTagline?: boolean;
  nameColor?: string;
  taglineColor?: string;
  enter?: boolean;
};

export const BrandLogo = ({
  size = 132,
  showName = true,
  showTagline = false,
  nameColor = colors.white,
  taglineColor = "rgba(255,255,255,.88)",
  enter = true,
}: BrandLogoProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = enter
    ? spring({ frame, fps, config: { damping: 16, stiffness: 110, mass: 0.9 } })
    : 1;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: rise,
        transform: `scale(${0.94 + rise * 0.06})`,
      }}
    >
      <Img
        src={staticFile("logo.png")}
        style={{ width: size, height: size, marginBottom: showName ? 28 : 0 }}
      />
      {showName ? (
        <div
          style={{
            fontFamily: "DM Serif Display",
            fontSize: size * 0.59,
            color: nameColor,
            letterSpacing: -1,
          }}
        >
          GetVideosLocally
        </div>
      ) : null}
      {showTagline ? (
        <div
          style={{
            marginTop: 14,
            fontSize: 28,
            fontWeight: 600,
            color: taglineColor,
            fontFamily: "Manrope",
          }}
        >
          Download what you need. Keep what you download.
        </div>
      ) : null}
    </div>
  );
};
