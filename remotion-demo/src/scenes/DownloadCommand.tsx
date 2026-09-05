import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Pointer } from "../components/Pointer";
import { colors, copy, fonts } from "../theme";

const COMMAND = copy.demoUrl;

export const DownloadCommand = () => {
  const frame = useCurrentFrame();

  const typedCount = Math.floor(
    interpolate(frame, [12, 92], [0, COMMAND.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typed = COMMAND.slice(0, typedCount);
  const caretOn = Math.floor(frame / 8) % 2 === 0;
  const showCaret = frame < 108;

  const sendReady = interpolate(frame, [96, 108], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const click = interpolate(frame, [116, 122, 132], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pressed = interpolate(frame, [116, 122, 136], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(frame, [0, 18, 108, 118], [240, 620, 620, 960], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const cursorY = interpolate(frame, [0, 18, 108, 118], [220, 498, 498, 628], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const zoom = interpolate(frame, [0, 20], [1.08, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.champagneSoft,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.sans,
      }}
    >
      <div
        style={{
          width: 1280,
          transform: `scale(${zoom})`,
          background: colors.card,
          borderRadius: 20,
          border: `1px solid ${colors.border}`,
          boxShadow: "0 30px 80px rgba(17,17,17,0.14)",
          padding: "42px 48px 40px",
        }}
      >
        <div
          style={{
            color: colors.ruby,
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Start the download
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 42,
            color: colors.ink,
            marginBottom: 28,
          }}
        >
          Paste a video URL, then send it.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: colors.input,
            borderRadius: 12,
            border: `1.5px solid ${typed.length > 0 ? colors.ruby : colors.border}`,
            padding: "18px 18px",
            minHeight: 72,
          }}
        >
          <div
            style={{
              flex: 1,
              fontSize: 26,
              color: typed.length > 0 ? colors.ink : "#9a9a9a",
              fontWeight: 600,
              letterSpacing: -0.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {typed || copy.inputPlaceholder}
            {showCaret ? (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: 28,
                  background: colors.ruby,
                  marginLeft: 2,
                  transform: "translateY(4px)",
                  opacity: caretOn ? 1 : 0,
                }}
              />
            ) : null}
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            height: 72,
            borderRadius: 12,
            background: colors.ruby,
            color: colors.white,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            fontSize: 24,
            fontWeight: 800,
            transform: `translateY(${pressed * 3}px) scale(${1 - pressed * 0.015 + sendReady * 0.01})`,
            boxShadow: sendReady
              ? "0 14px 28px rgba(155, 17, 30, 0.28)"
              : "0 8px 18px rgba(155, 17, 30, 0.16)",
          }}
        >
          <SendIcon />
          {copy.downloadCta}
        </div>
      </div>
      <Pointer x={cursorX} y={cursorY} click={click} />
    </AbsoluteFill>
  );
};

const SendIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 4v12M12 16l-5-5M12 16l5-5M5 20h14"
      stroke="white"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
