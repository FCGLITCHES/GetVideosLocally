import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts } from "../theme";
import { fadeOut } from "../components/ScreenshotFrame";
import { SCENE } from "../timings";

const cards = [
  {
    label: "Premium required",
    detail: "Download unavailable on your plan",
    tone: colors.ruby,
  },
  {
    label: "Quality capped",
    detail: "1080p max unless you upgrade",
    tone: "#d97706",
  },
  {
    label: "Sign in to continue",
    detail: "Your session expired mid-watch",
    tone: "#475467",
  },
  {
    label: "Offline blocked",
    detail: "Streaming only — no local file",
    tone: colors.rubyDeep,
  },
];

export const PaywallMontage = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.montage - 10, SCENE.montage - 2);

  const cut = Math.min(
    Math.floor(frame / 28),
    cards.length - 1,
  );
  const local = frame - cut * 28;
  const cardOpacity = interpolate(local, [0, 8, 22, 28], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cardScale = interpolate(local, [0, 10], [1.06, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const card = cards[cut];

  return (
    <AbsoluteFill
      style={{
        background: colors.ink,
        fontFamily: fonts.sans,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 96,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 2.4,
          textTransform: "uppercase",
          color: "rgba(255,255,255,.45)",
        }}
      >
        The friction stack
      </div>

      <div
        style={{
          width: 920,
          padding: "52px 56px",
          borderRadius: 24,
          background: colors.white,
          transform: `scale(${cardScale})`,
          opacity: cardOpacity,
          boxShadow: "0 30px 80px rgba(0,0,0,.35)",
        }}
      >
        <div
          style={{
            width: 64,
            height: 6,
            borderRadius: 99,
            background: card.tone,
            marginBottom: 28,
          }}
        />
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 64,
            lineHeight: 1.05,
            color: colors.ink,
          }}
        >
          {card.label}
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 28,
            fontWeight: 600,
            color: colors.muted,
          }}
        >
          {card.detail}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 72,
          display: "flex",
          gap: 10,
        }}
      >
        {cards.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === cut ? 28 : 10,
              height: 10,
              borderRadius: 99,
              background:
                i === cut ? colors.ruby : "rgba(255,255,255,.25)",
              transition: "width 0.2s",
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
