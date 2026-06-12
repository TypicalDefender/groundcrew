/**
 * One place that decides which visual tone every status value gets, so a
 * CI chip on a card and the same fact in the drawer can never disagree.
 */

import type { CiStatus, PulseState, ReviewState } from "@clipboard-health/groundcrew";

import { chip, type ChipTone, pulseDot } from "@/lib/theme";

const CI_TONES: Record<CiStatus, ChipTone> = {
  passing: chip.success,
  failing: chip.error,
  pending: chip.pending,
  unknown: chip.muted,
};

const REVIEW_TONES: Record<ReviewState, ChipTone> = {
  approved: chip.success,
  "changes-requested": chip.error,
  pending: chip.info,
  none: chip.muted,
};

export function ciTone(ci: CiStatus): ChipTone {
  return CI_TONES[ci];
}

export function reviewTone(review: ReviewState): ChipTone {
  return REVIEW_TONES[review];
}

export function pulseColor(pulse: PulseState): string {
  return pulseDot[pulse];
}
