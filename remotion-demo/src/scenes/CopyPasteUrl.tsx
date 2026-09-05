import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Pointer } from "../components/Pointer";
import { ProductWindow } from "../components/ProductWindow";
import { colors, copy, fonts } from "../theme";

export const CopyPasteUrl = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const profileEnter = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 90 },
  });

  const copied = interpolate(frame, [58, 66], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const shiftToApp = interpolate(frame, [78, 108], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const pasted = interpolate(frame, [124, 132], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorX = interpolate(
    frame,
    [8, 48, 78, 118],
    [1180, 790, 790, 1040],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const cursorY = interpolate(
    frame,
    [8, 48, 78, 118],
    [180, 478, 478, 442],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const click = Math.max(
    interpolate(frame, [50, 56, 64], [0, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    interpolate(frame, [120, 126, 134], [0, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  return (
    <AbsoluteFill
      style={{
        background: colors.champagneSoft,
        fontFamily: fonts.sans,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 88,
          opacity: interpolate(shiftToApp, [0, 1], [1, 0]),
          transform: `translateX(${interpolate(shiftToApp, [0, 1], [0, -80])}px) scale(${0.92 + profileEnter * 0.08})`,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: 2.4,
            textTransform: "uppercase",
            color: colors.ruby,
            marginBottom: 18,
          }}
        >
          Keep this file
        </div>
        <div
          style={{
            width: 760,
            background: colors.card,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 24px 60px rgba(17,17,17,0.12)",
            border: `1px solid ${colors.border}`,
          }}
        >
          <Img
            src={staticFile("profile-clip.png")}
            style={{ width: 760, height: 211, objectFit: "cover", display: "block" }}
          />
          <div style={{ padding: "22px 26px 26px" }}>
            <div style={{ fontFamily: fonts.display, fontSize: 34, color: colors.ink }}>
              {copy.profileTitle}
            </div>
            <div style={{ marginTop: 8, color: colors.muted, fontSize: 18 }}>
              {copy.profileMeta}
            </div>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: colors.input,
                borderRadius: 10,
                padding: "12px 14px",
                border: `1px solid ${colors.border}`,
              }}
            >
              <div
                style={{
                  flex: 1,
                  fontSize: 16,
                  color: colors.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                {copy.demoUrl}
              </div>
              <div
                style={{
                  background: colors.ruby,
                  color: colors.white,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Copy
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 90,
          top: 54,
          opacity: shiftToApp,
          transform: `translateY(${interpolate(shiftToApp, [0, 1], [36, 0])}px)`,
        }}
      >
        <ProductWindow queued={0} downloading={0} downloaded={0} width={1740} scale={0.96}>
          <div style={{ display: "flex", gap: 22, padding: 28, minHeight: 620 }}>
            <div
              style={{
                flex: 1,
                background: colors.card,
                borderRadius: 14,
                border: `1px solid ${colors.border}`,
                padding: "28px 30px",
              }}
            >
              <div style={{ color: colors.ruby, fontWeight: 800, fontSize: 26 }}>
                Download Videos from 1000+ Sites
              </div>
              <div style={{ marginTop: 10, color: colors.muted, fontSize: 16, lineHeight: 1.45 }}>
                Multi-site video downloading, processing, and format conversion for 1000+ supported
                sites, not just YouTube.
              </div>
              <div
                style={{
                  marginTop: 22,
                  display: "flex",
                  alignItems: "center",
                  background: colors.input,
                  borderRadius: 10,
                  border: `1px solid ${pasted > 0.5 ? colors.ruby : colors.border}`,
                  padding: "14px 14px",
                  minHeight: 54,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    color: pasted > 0.2 ? colors.ink : "#9a9a9a",
                    fontSize: 18,
                  }}
                >
                  {pasted > 0.2 ? copy.demoUrl : copy.inputPlaceholder}
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: pasted > 0.5 ? colors.champagne : colors.white,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${colors.border}`,
                    fontSize: 16,
                  }}
                >
                  ⎘
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 22 }}>
                <Field label="Format" value="MP4" />
                <Field label="Quality" value="Best available (up to 8K)" />
              </div>
              <div
                style={{
                  marginTop: 28,
                  background: colors.ruby,
                  color: colors.white,
                  borderRadius: 10,
                  textAlign: "center",
                  padding: "16px 0",
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                ↓  {copy.downloadCta}
              </div>
            </div>
            <div
              style={{
                width: 620,
                borderRadius: 14,
                border: `1px solid ${colors.border}`,
                background: colors.card,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: colors.muted,
                gap: 10,
              }}
            >
              <div style={{ fontSize: 42, color: colors.ruby, opacity: 0.85 }}>↓</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#888" }}>No downloads yet</div>
              <div style={{ fontSize: 15 }}>Paste a video URL above to get started</div>
            </div>
          </div>
        </ProductWindow>
      </div>

      <div
        style={{
          position: "absolute",
          left: 780,
          top: 548,
          background: colors.ink,
          color: colors.white,
          borderRadius: 999,
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: 700,
          opacity: copied * (1 - shiftToApp),
        }}
      >
        URL copied
      </div>

      <Pointer x={cursorX} y={cursorY} click={click} />
    </AbsoluteFill>
  );
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div style={{ flex: 1 }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>
      {label}
    </div>
    <div
      style={{
        background: colors.input,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 16,
      }}
    >
      {value}
    </div>
  </div>
);
