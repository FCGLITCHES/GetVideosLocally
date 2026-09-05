import { Composition } from "remotion";
import { GetVideosLocallyDemo7 } from "./GetVideosLocallyDemo7";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./timings";

export const Root = () => (
  <Composition
    id="GetVideosLocallyDemo7"
    component={GetVideosLocallyDemo7}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
