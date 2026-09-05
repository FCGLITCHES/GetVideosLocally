import { Composition } from "remotion";
import { ProductDemo } from "./ProductDemo";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./timings";

export const Root = () => (
  <Composition
    id="GetVideosLocallyDemo6"
    component={ProductDemo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
