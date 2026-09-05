import { interpolate } from "remotion";
import { colors } from "../theme";

type WorkflowNodeProps = {
  label: string;
  icon: React.ReactNode;
  active?: number;
  index?: number;
};

export const WorkflowNode = ({
  label,
  icon,
  active = 0,
  index = 0,
}: WorkflowNodeProps) => {
  const scale = 0.92 + active * 0.08;
  const opacity = interpolate(active, [0, 1], [0.45, 1]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        opacity,
        transform: `scale(${scale})`,
        transition: "none",
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 24,
          background: active > 0.5 ? colors.ruby : colors.white,
          border: `2px solid ${active > 0.5 ? colors.ruby : colors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            active > 0.5
              ? "0 16px 40px rgba(155,17,30,.22)"
              : "0 8px 24px rgba(0,0,0,.06)",
          color: active > 0.5 ? colors.white : colors.ruby,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: active > 0.5 ? colors.ink : colors.muted,
          fontFamily: "Manrope",
          textAlign: "center",
        }}
      >
        {index}. {label}
      </div>
    </div>
  );
};

export const LinkIcon = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
    <path
      d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const QualityIcon = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M8 15l3-3 2 2 3-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const FileIcon = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
    <path
      d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" />
    <path d="M12 18v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 15h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
