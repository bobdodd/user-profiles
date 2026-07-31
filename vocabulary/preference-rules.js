/* Inference rules: high-level preferences implying lower-level ones.
 * ---------------------------------------------------------------------------
 * Written in the Action Language, so an inference is a declared, inspectable,
 * traceable expression rather than code somewhere deciding things about people.
 *
 * WHAT AN INFERENCE IS, AND IS NOT. It is following through on what somebody
 * already said. Asking for help with text perception IS a statement about
 * letterforms and spacing; the person simply did not enumerate it, and would
 * not thank anyone for making them. It is NOT the system deciding what they
 * want. The difference is enforced rather than promised:
 *
 *   - an inference never overwrites a stated value. Where the person has
 *     spoken, their value stands and the rule's is kept in `overruled`.
 *   - provenance is recorded, so a stated preference and an inferred one are
 *     never confused, and inferences can be redrawn when the choice they came
 *     from changes.
 *   - nothing infers a HIGH-level preference from a capability profile. The
 *     cascade only ever runs downward, from something the person chose.
 *
 * That last rule is the one with teeth. A system that decided somebody needed
 * help with text perception on the strength of what it believed about them
 * would be labelling, which is what the capability model exists to avoid.
 */

import { A } from "action-language";

/** Help with text perception, expanded.
 *
 *  Bob's worked example. One thing the person turns on, reaching three
 *  categories: which senses are used together, what the letterforms must
 *  manage, how much contrast, and how much air between characters, words and
 *  lines.
 *
 *  The contrast entry is the one to look at. A capability profile with intact
 *  contrast sensitivity would suggest strong contrast is fine. This softens it
 *  anyway, because for a lot of people high contrast is what makes text swim.
 *  Nothing in the model objects, and that is the design working. */
export const helpWithTextPerception = {
  id: "help-with-text-perception",
  reads: ["helpWithTextPerception"],
  writes: [
    "channelsTogether", "fontQualities", "textContrast",
    "letterSpacing", "wordSpacing", "lineSpacing",
  ],
  cite:
    "When helpWithTextPerception is on: read along in visual+sonic together; " +
    "require mirrored-letters-differ, one-el-eye-differ, open-apertures and " +
    "plain-shapes of the typeface; soften contrast; and open up letter, word " +
    "and line spacing to 1.2x, 1.6x and 1.5x.",
  body: A.ifThen(
    A.eq(A.preferred("helpWithTextPerception"), A.lit(true)),
    A.seq(
      /* Text AND speech together, not one instead of the other. Reading along
       * is the point, so this is a set and could not be an order. */
      A.prefer("channelsTogether", A.lit(["visual", "sonic"])),

      /* What the typeface must manage. Not a typeface: the requirement
       * survives a font not being installed, and lets a renderer pick. */
      A.prefer("fontQualities", A.lit([
        "mirrored-letters-differ", "one-el-eye-differ",
        "open-apertures", "plain-shapes",
      ])),

      /* Softer, not stronger. See the note above. */
      A.prefer("textContrast", A.lit("softened")),

      A.prefer("letterSpacing", A.lit(1.2)),
      A.prefer("wordSpacing", A.lit(1.6)),
      A.prefer("lineSpacing", A.lit(1.5)),
    ),
    A.lit(null),
  ),
};

/** Ranking a sense first implies wanting the tools that speak it.
 *
 *  A second, shallower cascade, kept because it demonstrates the ordering from
 *  the other end: a designSpace choice reaching tooling directly, with nothing
 *  in perception between them. */
export const sonicFirstImpliesReader = {
  id: "sonic-first-implies-reader",
  reads: ["channelOrder"],
  writes: ["readingToolOrder"],
  cite:
    "Where the sonic design space is ranked first, prefer reading tools that " +
    "speak: screen-reader, then kurzweil, then reader-mode.",
  body: A.ifThen(
    A.eq(A.rankOf("channelOrder", A.lit("sonic")), A.lit(0)),
    A.prefer("readingToolOrder", A.lit(["screen-reader", "kurzweil", "reader-mode"])),
    A.lit(null),
  ),
};

export const rules = Object.freeze([helpWithTextPerception, sonicFirstImpliesReader]);

/** Run every rule in order, threading the preference set through.
 *
 *  Order matters and is declared rather than emergent: a rule may read what an
 *  earlier one inferred. What it may NOT do is quietly overwrite the person,
 *  which the write discipline handles regardless of ordering. */
export function applyRules(prefs, { run, inferPreference, only = null } = {}) {
  let current = prefs;
  const fired = [];
  for (const rule of rules) {
    if (only && !only.includes(rule.id)) continue;
    const result = run(rule.body, {
      preferences: current,
      inferPreference,
      ruleId: rule.id,
    });
    if (result.preferences) current = result.preferences;
    fired.push({ rule: rule.id, cite: rule.cite });
  }
  return { preferences: current, fired: Object.freeze(fired) };
}
