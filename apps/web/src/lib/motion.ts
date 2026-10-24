import type { Transition } from "motion/react";

/* MD3 easing and duration tokens (m3.material.io/styles/motion/easing-and-duration). */
export const easing = {
  standard: [0.2, 0, 0, 1],
  standardDecelerate: [0, 0, 0, 1],
  standardAccelerate: [0.3, 0, 1, 1],
  emphasized: [0.2, 0, 0, 1],
  emphasizedDecelerate: [0.05, 0.7, 0.1, 1],
  emphasizedAccelerate: [0.3, 0, 0.8, 0.15],
} as const satisfies Record<string, [number, number, number, number]>;

/* seconds */
export const duration = {
  short1: 0.05,
  short2: 0.1,
  short3: 0.15,
  short4: 0.2,
  medium1: 0.25,
  medium2: 0.3,
  medium3: 0.35,
  medium4: 0.4,
  long1: 0.45,
  long2: 0.5,
  long3: 0.55,
  long4: 0.6,
} as const;

export const t = (d: keyof typeof duration, e: keyof typeof easing): Transition => ({
  duration: duration[d],
  ease: easing[e],
});

/* Enter with emphasized decelerate, leave with emphasized accelerate (MD3 container transitions). */
export const enterExit = {
  enter: t("medium4", "emphasizedDecelerate"),
  exit: t("short4", "emphasizedAccelerate"),
};
