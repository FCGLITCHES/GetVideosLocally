export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Scene durations in frames @ 30fps */
export const SCENE = {
  intro: 120,
  phoneTrend: 105,
  montage: 120,
  cycle: 135,
  logoReveal: 90,
  homeScreen: 180,
  results: 165,
  cta: 150,
} as const;

export const TOTAL_FRAMES =
  SCENE.intro +
  SCENE.phoneTrend +
  SCENE.montage +
  SCENE.cycle +
  SCENE.logoReveal +
  SCENE.homeScreen +
  SCENE.results +
  SCENE.cta;

export const START = {
  intro: 0,
  phoneTrend: SCENE.intro,
  montage: SCENE.intro + SCENE.phoneTrend,
  cycle: SCENE.intro + SCENE.phoneTrend + SCENE.montage,
  logoReveal:
    SCENE.intro + SCENE.phoneTrend + SCENE.montage + SCENE.cycle,
  homeScreen:
    SCENE.intro +
    SCENE.phoneTrend +
    SCENE.montage +
    SCENE.cycle +
    SCENE.logoReveal,
  results:
    SCENE.intro +
    SCENE.phoneTrend +
    SCENE.montage +
    SCENE.cycle +
    SCENE.logoReveal +
    SCENE.homeScreen,
  cta:
    SCENE.intro +
    SCENE.phoneTrend +
    SCENE.montage +
    SCENE.cycle +
    SCENE.logoReveal +
    SCENE.homeScreen +
    SCENE.results,
} as const;
