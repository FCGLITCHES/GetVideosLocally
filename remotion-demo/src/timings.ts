export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const SCENE = {
  problem: 96,
  copyPaste: 156,
  command: 150,
  status: 126,
  cta: 102,
} as const;

export const TOTAL_FRAMES =
  SCENE.problem +
  SCENE.copyPaste +
  SCENE.command +
  SCENE.status +
  SCENE.cta;

export const START = {
  problem: 0,
  copyPaste: SCENE.problem,
  command: SCENE.problem + SCENE.copyPaste,
  status: SCENE.problem + SCENE.copyPaste + SCENE.command,
  cta: SCENE.problem + SCENE.copyPaste + SCENE.command + SCENE.status,
} as const;
