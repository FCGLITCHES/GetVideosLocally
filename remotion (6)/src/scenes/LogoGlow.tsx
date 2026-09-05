import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrandLogo } from "../components/BrandLogo";
import { sceneFadeOut } from "../components/SceneFade";
import { colors, copy } from "../theme";
import { SCENE } from "../timings";

export const LogoGlow = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = sceneFadeOut(frame, SCENE.logo);

  const reveal = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const glow = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.dark,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: 999,
          background: `radial-gradient(circle, rgba(155,17,30,${0.35 * glow}) 0%, transparent 70%)`,
          transform: `scale(${0.8 + glow * 0.3})`,
        }}
      />
      <BrandLogo
        size={128}
        showName
        showTagline
        tagline={copy.promise}
        nameColor={colors.white}
        taglineColor="rgba(255,255,255,.75)"
        opacity={Math.min(reveal, 1)}
        scale={0.88 + Math.min(reveal, 1) * 0.12}
      />
    </AbsoluteFill>
  );
};
