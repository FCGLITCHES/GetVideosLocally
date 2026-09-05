import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { fadeIn, fadeOut } from "../components/ProductScreenshot";
import {
  FileIcon,
  LinkIcon,
  QualityIcon,
  WorkflowNode,
} from "../components/WorkflowNode";
import { colors, fonts } from "../theme";
import { SCENE } from "../timings";

const NODES = [
  { label: "Paste link", icon: <LinkIcon /> },
  { label: "Choose quality", icon: <QualityIcon /> },
  { label: "Save locally", icon: <FileIcon /> },
];

export const WorkflowScene = () => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, SCENE.workflow - 12, SCENE.workflow - 2);

  const node1 = fadeIn(frame, 8, 20);
  const node2 = fadeIn(frame, 28, 40);
  const node3 = fadeIn(frame, 48, 60);
  const connector = interpolate(frame, [20, 72], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const active1 = interpolate(frame, [20, 36, 44], [1, 1, 0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const active2 = interpolate(frame, [44, 60, 72], [0.3, 1, 0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const active3 = interpolate(frame, [72, 88, 100], [0.3, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const thatsIt = fadeIn(frame, 92, 108);
  const expand = interpolate(frame, [108, 118], [1, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cameraX = interpolate(frame, [20, 44, 72], [0, -20, 20], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const actives = [active1, active2, active3];
  const nodeIns = [node1, node2, node3];

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${colors.champagneSoft} 0%, ${colors.paper} 100%)`,
        fontFamily: fonts.sans,
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
      }}
    >
      <div
        style={{
          transform: `translateX(${cameraX}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 80 }}>
          <div
            style={{
              position: "absolute",
              left: 80,
              right: 80,
              top: 60,
              height: 4,
              background: colors.border,
              borderRadius: 4,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 80,
              top: 60,
              height: 4,
              width: `${connector * 0.72}%`,
              background: colors.ruby,
              borderRadius: 4,
            }}
          />
          {NODES.map((node, i) => (
            <div key={node.label} style={{ opacity: nodeIns[i], zIndex: 1 }}>
              <WorkflowNode
                label={node.label}
                icon={node.icon}
                active={actives[i]}
                index={i + 1}
              />
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 56,
            fontSize: 48,
            fontWeight: 800,
            color: colors.ink,
            opacity: thatsIt,
            letterSpacing: -1,
          }}
        >
          That&apos;s it.
        </div>

        <div
          style={{
            marginTop: 40,
            opacity: interpolate(frame, [108, 118], [0, 0.3], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            transform: `scale(${expand})`,
          }}
        >
          <WorkflowNode label="Save locally" icon={<FileIcon />} active={1} index={3} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
