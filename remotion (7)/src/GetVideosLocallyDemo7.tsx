import { AbsoluteFill, Sequence } from "remotion";
import { FontFaces } from "./components/FontFaces";
import { DetectScene } from "./scenes/DetectScene";
import { DownloadScene } from "./scenes/DownloadScene";
import { IntroScene } from "./scenes/IntroScene";
import { LinkScene } from "./scenes/LinkScene";
import { LogoRevealScene } from "./scenes/LogoRevealScene";
import { OutroScene } from "./scenes/OutroScene";
import { ResultScene } from "./scenes/ResultScene";
import { WorkflowScene } from "./scenes/WorkflowScene";
import { SCENE, START } from "./timings";

export const GetVideosLocallyDemo7 = () => (
  <AbsoluteFill>
    <FontFaces />
    <Sequence from={START.intro} durationInFrames={SCENE.intro} name="1 Intro">
      <IntroScene />
    </Sequence>
    <Sequence from={START.link} durationInFrames={SCENE.link} name="2 The Link">
      <LinkScene />
    </Sequence>
    <Sequence
      from={START.detect}
      durationInFrames={SCENE.detect}
      name="3 Paste → Detect"
    >
      <DetectScene />
    </Sequence>
    <Sequence
      from={START.workflow}
      durationInFrames={SCENE.workflow}
      name="4 How It Works"
    >
      <WorkflowScene />
    </Sequence>
    <Sequence
      from={START.logoReveal}
      durationInFrames={SCENE.logoReveal}
      name="5 Product Reveal"
    >
      <LogoRevealScene />
    </Sequence>
    <Sequence
      from={START.download}
      durationInFrames={SCENE.download}
      name="6 Choose → Download"
    >
      <DownloadScene />
    </Sequence>
    <Sequence from={START.result} durationInFrames={SCENE.result} name="7 Result">
      <ResultScene />
    </Sequence>
    <Sequence from={START.outro} durationInFrames={SCENE.outro} name="8 CTA">
      <OutroScene />
    </Sequence>
  </AbsoluteFill>
);
