import { useReducedMotion, type Transition, type Variants } from "framer-motion";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function tween(duration: number): Transition {
  return { type: "tween", ease: EASE, duration };
}

export const listItemTransition: Transition = {
  ...tween(0.28),
  layout: { type: "tween", ease: EASE, duration: 0.3 }
};

export function useBannerMotion(): Variants {
  const reduced = useReducedMotion();
  return {
    initial: { opacity: 0, x: "-50%", y: reduced ? 0 : -8 },
    animate: { opacity: 1, x: "-50%", y: 0, transition: tween(0.24) },
    exit: { opacity: 0, x: "-50%", y: reduced ? 0 : -6, transition: tween(0.18) }
  };
}

export function useDialogMotion(): { backdrop: Variants; panel: Variants } {
  const reduced = useReducedMotion();
  return {
    backdrop: {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: tween(0.22) },
      exit: { opacity: 0, transition: tween(0.18) }
    },
    panel: {
      initial: { opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : 8 },
      animate: { opacity: 1, scale: 1, y: 0, transition: tween(0.28) },
      exit: { opacity: 0, scale: reduced ? 1 : 0.97, y: reduced ? 0 : 6, transition: tween(0.2) }
    }
  };
}

export function useListItemMotion(): Variants {
  const reduced = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduced ? 0 : 8 },
    animate: { opacity: 1, y: 0, transition: tween(0.24) },
    exit: { opacity: 0, y: reduced ? 0 : -6, transition: tween(0.18) }
  };
}
