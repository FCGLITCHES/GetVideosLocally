import { Composition } from "remotion";
import { ProductDemo } from "./ProductDemo";
import { HEIGHT, TOTAL_FRAMES, WIDTH, FPS } from "./timings";

export const Root = () => (
  <Composition
    id="GetVideosLocallyDemo5"
    component={ProductDemo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
