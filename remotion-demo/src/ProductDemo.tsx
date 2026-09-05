import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { FontFaces } from "./components/FontFaces";
import { CallToAction } from "./scenes/CallToAction";
import { CopyPasteUrl } from "./scenes/CopyPasteUrl";
import { DownloadCommand } from "./scenes/DownloadCommand";
import { ProblemStatement } from "./scenes/ProblemStatement";
import { SavedStatus } from "./scenes/SavedStatus";
import { colors } from "./theme";
import { SCENE, START } from "./timings";

export const ProductDemo = () => (
  <AbsoluteFill style={{ background: colors.ruby }}>
    <FontFaces />
    <Sequence from={START.problem} durationInFrames={SCENE.problem} name="Problem">
      <ProblemStatement />
    </Sequence>
    <Sequence from={START.copyPaste} durationInFrames={SCENE.copyPaste} name="Copy URL">
      <FadeIn>
        <CopyPasteUrl />
      </FadeIn>
    </Sequence>
    <Sequence from={START.command} durationInFrames={SCENE.command} name="Download command">
      <FadeIn>
        <DownloadCommand />
      </FadeIn>
    </Sequence>
    <Sequence from={START.status} durationInFrames={SCENE.status} name="Saved locally">
      <FadeIn>
        <SavedStatus />
      </FadeIn>
    </Sequence>
    <Sequence from={START.cta} durationInFrames={SCENE.cta} name="Download free">
      <FadeIn>
        <CallToAction />
      </FadeIn>
    </Sequence>
  </AbsoluteFill>
);

const FadeIn = ({ children }: { children: ReactNode }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
