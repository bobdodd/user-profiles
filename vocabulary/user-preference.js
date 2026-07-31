/* The Preference Model population: what a person would rather.
 * ---------------------------------------------------------------------------
 * A schema, not a profile. No user appears here. Values live in profiles.
 *
 * NAMED IN THE USER'S WORDS, NOT A PROFESSION'S (Bob 2026-07-30). A preference
 * is something a person chooses, so its name has to be a phrase they would
 * use. "Help with text perception" is a preference. "Dyslexia support" names a
 * condition and labels whoever picks it. "High-legibility reading" and
 * "letter-shape clarity" are accessibility jargon wearing a user-facing
 * disguise, which I proposed and Bob rejected for exactly that reason.
 *
 * THE FOUR CATEGORIES, at descending levels of abstraction. A choice at one
 * level implies choices below it, which is what makes the ordering useful
 * rather than merely tidy:
 *
 *   designSpace  which sense carries meaning at all
 *   modality     which interaction channel is used
 *   perception   how it is presented within a chosen channel
 *   tooling      which named tool, with what settings
 *
 * CAPABILITY DOES NOT BOUND ANY OF THIS. `softerTextContrast` below is the
 * clearest case: a capability profile with intact contrast sensitivity would
 * suggest strong contrast is fine, and a person may want less. They are not
 * wrong and the model does not argue.
 */

import { definePreference } from "../model/preference.js";
import { userCapability } from "./user-capability.js";

/* Derived from the capability model rather than restated, so the two cannot
 * drift apart. These are the ontologies the capability side marks as Nesbitt
 * design spaces; `motor` and `language` are ontologies but not senses, so they
 * are not something to rank as channels for carrying meaning. */
const DESIGN_SPACES = Object.values(userCapability.ontologies)
  .filter((o) => o.designSpace)
  .map((o) => o.name);

/* The input channels the capability model can describe. Named for what a
 * person does, not for the property that records it. */
const INPUT_CHANNELS = [
  "keyboard", "pointer", "touch", "speech", "switch", "gaze", "breath", "head",
];

/* What a font has to DO, not which font it is. A requirement survives the
 * typeface not being installed, and lets the renderer choose; naming a face
 * would not. */
const FONT_QUALITIES = [
  "mirrored-letters-differ",   // b and d, p and q are not reflections
  "one-el-eye-differ",         // 1, l and I told apart; numbers as much as letters
  "open-apertures",            // c, e, a do not close up
  "generous-counters",         // the holes in a, e, o stay open
  "plain-shapes",              // no decorative or script forms
];

export const userPreference = definePreference({
  id: "a11ybob.user-preference",
  version: "1",

  categories: {
    designSpace: {
      description:
        "Which sense carries meaning. The widest choice there is, and the one " +
        "that decides what every lower choice is even about.",
    },
    modality: {
      description: "Which channel the person uses to act on the thing.",
    },
    perception: {
      description:
        "How content is presented once a channel is chosen. Size, colour, " +
        "spacing, letterforms.",
    },
    tooling: {
      description:
        "Named tools and how they are set up. Deliberately the loosest " +
        "category: a tool is a solution, and any list of them trails whatever " +
        "technology the person happens to know about.",
    },
  },

  preferences: {
    /* --- designSpace ---------------------------------------------------- */

    channelOrder: {
      category: "designSpace",
      kind: "ranked",
      domain: DESIGN_SPACES,
      description:
        "Senses that may carry meaning, most preferred first. Partial: saying " +
        "sonic comes before visual says nothing about haptic, and nobody has " +
        "to rank everything to state a view about something.",
    },

    channelsTogether: {
      category: "designSpace",
      kind: "valued",
      measurement: { type: "discrete", values: DESIGN_SPACES, multiple: true },
      description:
        "Senses to use AT THE SAME TIME, carrying the same content. A set, " +
        "not an order, and the distinction is load-bearing: reading along " +
        "with speech wants text and audio together, which no ranking can say. " +
        "An order would mean one as a fallback for the other.",
    },

    /* --- modality ------------------------------------------------------- */

    inputOrder: {
      category: "modality",
      kind: "ranked",
      domain: INPUT_CHANNELS,
      description: "Ways of acting on the interface, most preferred first.",
    },

    /* --- perception ----------------------------------------------------- */

    helpWithTextPerception: {
      category: "perception",
      kind: "valued",
      measurement: { type: "boolean" },
      description:
        "Asks for text to be made easier to take in. Serves readers whose " +
        "difficulty is with taking text IN rather than with seeing it, " +
        "dyslexic and dyscalculic readers most obviously, though nothing " +
        "restricts it to them and anyone may choose it. A bundle the person " +
        "chooses, which infers letterforms, contrast and spacing below. " +
        "STATED ONLY: nothing may infer this one from a capability profile, " +
        "because a system deciding somebody needs it on the strength of what " +
        "it believes about them is the labelling this whole model exists to " +
        "avoid.",
    },

    fontQualities: {
      category: "perception",
      kind: "valued",
      measurement: { type: "discrete", values: FONT_QUALITIES, multiple: true },
      description:
        "What the typeface has to manage, rather than which typeface. A " +
        "requirement outlives a font not being installed and lets the " +
        "renderer choose one that satisfies it.",
    },

    textContrast: {
      category: "perception",
      kind: "valued",
      measurement: {
        type: "discrete",
        values: ["softened", "standard", "raised", "maximum"],
      },
      qualifies: "contrastSensitivity",
      description:
        "How much contrast is wanted. Note `softened`: a capability profile " +
        "with intact contrast sensitivity would suggest strong contrast is " +
        "fine, and plenty of people find it tiring and want less. The " +
        "capability model does not get a vote.",
    },

    letterSpacing: {
      category: "perception",
      kind: "valued",
      measurement: { type: "numeric", min: 1, max: 2, unit: "x" },
      description: "Space between characters, as a multiple of the font's own.",
    },

    wordSpacing: {
      category: "perception",
      kind: "valued",
      measurement: { type: "numeric", min: 1, max: 3, unit: "x" },
      description: "Space between words, as a multiple of the font's own.",
    },

    lineSpacing: {
      category: "perception",
      kind: "valued",
      measurement: { type: "numeric", min: 1, max: 3, unit: "x" },
      description: "Space between lines, as a multiple of the font's own.",
    },

    readFontSize: {
      category: "perception",
      kind: "valued",
      measurement: { type: "numeric", min: 4, max: 96, unit: "pt" },
      qualifies: "minReadFontSizeForFont",
      description:
        "Reading size wanted. Sits BESIDE the capability that computes a " +
        "smallest legible size, and is not bounded by it in either direction.",
    },

    /* --- tooling -------------------------------------------------------- */

    readingToolOrder: {
      category: "tooling",
      kind: "ranked",
      domain: ["kurzweil", "reader-mode", "screen-reader", "none"],
      description: "Reading tools, most preferred first.",
    },

    /* A TOOL IS A NAMED THING WITH TYPED PROPERTIES, which is what a composite
     * is: the preference key is the tool, the parts are its settings, each
     * with its own value type. Parts are optional — naming a tool without
     * setting all of its knobs is the ordinary case. */
    kurzweil: {
      category: "tooling",
      kind: "valued",
      measurement: {
        type: "composite",
        parts: [
          { name: "speechRate", type: "numeric", min: 80, max: 400, unit: "wpm" },
          { name: "highlightWords", type: "boolean" },
          { name: "highlightColour", type: "text" },
        ],
      },
      description: "Kurzweil, and how it is set up.",
    },

    readerMode: {
      category: "tooling",
      kind: "valued",
      measurement: {
        type: "composite",
        parts: [
          { name: "columnWidth", type: "numeric", min: 20, max: 120, unit: "ch" },
          { name: "hideImages", type: "boolean" },
        ],
      },
      description: "The browser's own reader view, and how it is set up.",
    },
  },
});

export { DESIGN_SPACES, INPUT_CHANNELS, FONT_QUALITIES };
