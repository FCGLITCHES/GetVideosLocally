export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Scene durations in frames @ 30fps */
export const SCENE = {
  intro: 120,
  link: 120,
  detect: 135,
  workflow: 120,
  logoReveal: 75,
  download: 210,
  result: 150,
  outro: 135,
} as const;

export const TOTAL_FRAMES =
  SCENE.intro +
  SCENE.link +
  SCENE.detect +
  SCENE.workflow +
  SCENE.logoReveal +
  SCENE.download +
  SCENE.result +
  SCENE.outro;

export const START = {
  intro: 0,
  link: SCENE.intro,
  detect: SCENE.intro + SCENE.link,
  workflow: SCENE.intro + SCENE.link + SCENE.detect,
  logoReveal:
    SCENE.intro + SCENE.link + SCENE.detect + SCENE.workflow,
  download:
    SCENE.intro +
    SCENE.link +
    SCENE.detect +
    SCENE.workflow +
    SCENE.logoReveal,
  result:
    SCENE.intro +
    SCENE.link +
    SCENE.detect +
    SCENE.workflow +
    SCENE.logoReveal +
    SCENE.download,
  outro:
    SCENE.intro +
    SCENE.link +
    SCENE.detect +
    SCENE.workflow +
    SCENE.logoReveal +
    SCENE.download +
    SCENE.result,
} as const;
