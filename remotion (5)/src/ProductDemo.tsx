import { AbsoluteFill, Sequence } from "remotion";
import { FontFaces } from "./components/FontFaces";
import { CallToAction } from "./scenes/CallToAction";
import { HomeScreenDemo } from "./scenes/HomeScreenDemo";
import { IntroTitle } from "./scenes/IntroTitle";
import { LinkTrendingPhone } from "./scenes/LinkTrendingPhone";
import { LogoReveal } from "./scenes/LogoReveal";
import { PaywallMontage } from "./scenes/PaywallMontage";
import { ResultsAnimation } from "./scenes/ResultsAnimation";
import { SubscriptionCycle } from "./scenes/SubscriptionCycle";
import { SCENE, START } from "./timings";

export const ProductDemo = () => (
  <AbsoluteFill>
    <FontFaces />
    <Sequence from={START.intro} durationInFrames={SCENE.intro} name="1 Intro">
      <IntroTitle />
    </Sequence>
    <Sequence
      from={START.phoneTrend}
      durationInFrames={SCENE.phoneTrend}
      name="2 Phone trend"
    >
      <LinkTrendingPhone />
    </Sequence>
    <Sequence
      from={START.montage}
      durationInFrames={SCENE.montage}
      name="3 Paywall montage"
    >
      <PaywallMontage />
    </Sequence>
    <Sequence
      from={START.cycle}
      durationInFrames={SCENE.cycle}
      name="4 Subscription cycle"
    >
      <SubscriptionCycle />
    </Sequence>
    <Sequence
      from={START.logoReveal}
      durationInFrames={SCENE.logoReveal}
      name="5 Logo reveal"
    >
      <LogoReveal />
    </Sequence>
    <Sequence
      from={START.homeScreen}
      durationInFrames={SCENE.homeScreen}
      name="6 Home screen"
    >
      <HomeScreenDemo />
    </Sequence>
    <Sequence
      from={START.results}
      durationInFrames={SCENE.results}
      name="7 Results"
    >
      <ResultsAnimation />
    </Sequence>
    <Sequence from={START.cta} durationInFrames={SCENE.cta} name="8 CTA">
      <CallToAction />
    </Sequence>
  </AbsoluteFill>
);
