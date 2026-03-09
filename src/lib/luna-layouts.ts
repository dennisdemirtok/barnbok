/**
 * Luna-style layout system for varied, natural-feeling page compositions.
 *
 * All layouts are designed for PORTRAIT illustrations (14×21cm),
 * which is what Gemini generates for bildbok-separat-text format.
 *
 * Layouts:
 * - text-left-img-right:       Text page left, full illustration right
 * - img-left-text-right:       Full illustration left, text page right
 * - text-left-img-right-3q:    Text left, image 3/4 right + text below image
 * - img-left-3q-text-right:    Image 3/4 left + text below, main text right
 * - text-around-img-center:    Portrait image centered, text columns on both sides
 */

export type LunaLayout =
  | 'text-left-img-right'
  | 'img-left-text-right'
  | 'text-left-img-right-3q'
  | 'img-left-3q-text-right'
  | 'text-around-img-center';

/**
 * Pick a layout for a given spread index.
 * The sequence is designed to feel varied and natural -
 * never the same layout twice in a row.
 */
export function pickLunaLayout(spreadIndex: number): LunaLayout {
  const sequence: LunaLayout[] = [
    'text-left-img-right',        // 0: Classic opening
    'img-left-3q-text-right',     // 1: Dynamic partial left
    'img-left-text-right',        // 2: Full mirror
    'text-left-img-right-3q',     // 3: Partial image right
    'text-around-img-center',     // 4: Centered portrait image, text both sides
    'img-left-text-right',        // 5: Mirror again
    'text-left-img-right',        // 6: Back to classic
    'text-left-img-right-3q',     // 7: Another partial variation
  ];
  return sequence[spreadIndex % sequence.length];
}
