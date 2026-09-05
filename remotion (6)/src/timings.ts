export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Scene durations in frames @ 30fps — demo 6 pacing (tighter than demo 5) */
export const SCENE = {
  hook: 105,
  share: 90,
  friction: 105,
  loop: 120,
  logo: 75,
  workflow: 195,
  library: 180,
  outro: 135,
} as const;

export const TOTAL_FRAMES =
  SCENE.hook +
  SCENE.share +
  SCENE.friction +
  SCENE.loop +
  SCENE.logo +
  SCENE.workflow +
  SCENE.library +
  SCENE.outro;

export const START = {
  hook: 0,
  share: SCENE.hook,
  friction: SCENE.hook + SCENE.share,
  loop: SCENE.hook + SCENE.share + SCENE.friction,
  logo: SCENE.hook + SCENE.share + SCENE.friction + SCENE.loop,
  workflow:
    SCENE.hook + SCENE.share + SCENE.friction + SCENE.loop + SCENE.logo,
  library:
    SCENE.hook +
    SCENE.share +
    SCENE.friction +
    SCENE.loop +
    SCENE.logo +
    SCENE.workflow,
  outro:
    SCENE.hook +
    SCENE.share +
    SCENE.friction +
    SCENE.loop +
    SCENE.logo +
    SCENE.workflow +
    SCENE.library,
} as const;
