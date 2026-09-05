import { AbsoluteFill, Sequence } from "remotion";
import { FontFaces } from "./components/FontFaces";
import { DesktopShare } from "./scenes/DesktopShare";
import { FrictionTicker } from "./scenes/FrictionTicker";
import { HookCascade } from "./scenes/HookCascade";
import { LibraryBuild } from "./scenes/LibraryBuild";
import { LogoGlow } from "./scenes/LogoGlow";
import { OutroPanel } from "./scenes/OutroPanel";
import { PasteAndPick } from "./scenes/PasteAndPick";
import { StreamTrapLoop } from "./scenes/StreamTrapLoop";
import { SCENE, START } from "./timings";

export const ProductDemo = () => (
  <AbsoluteFill>
    <FontFaces />
    <Sequence from={START.hook} durationInFrames={SCENE.hook} name="1 Hook">
      <HookCascade />
    </Sequence>
    <Sequence from={START.share} durationInFrames={SCENE.share} name="2 Share">
      <DesktopShare />
    </Sequence>
    <Sequence
      from={START.friction}
      durationInFrames={SCENE.friction}
      name="3 Friction"
    >
      <FrictionTicker />
    </Sequence>
    <Sequence from={START.loop} durationInFrames={SCENE.loop} name="4 Loop">
      <StreamTrapLoop />
    </Sequence>
    <Sequence from={START.logo} durationInFrames={SCENE.logo} name="5 Logo">
      <LogoGlow />
    </Sequence>
    <Sequence
      from={START.workflow}
      durationInFrames={SCENE.workflow}
      name="6 Workflow"
    >
      <PasteAndPick />
    </Sequence>
    <Sequence
      from={START.library}
      durationInFrames={SCENE.library}
      name="7 Library"
    >
      <LibraryBuild />
    </Sequence>
    <Sequence from={START.outro} durationInFrames={SCENE.outro} name="8 Outro">
      <OutroPanel />
    </Sequence>
  </AbsoluteFill>
);
