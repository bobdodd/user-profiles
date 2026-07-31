/* Tests for the Capability and Capacity Models, and the Action Language that
 * evaluates their dependencies.
 *
 * Same harness as semantics.test.mjs: no framework, the cradle is the framework.
 * Roughly half of these assert that the models REFUSE something — a capability
 * beneath one that does not exist, a measurement against FULL, a precedence
 * cycle. A capability model that accepts anything describes nobody. */

import { defineCapability, CapabilityError, propertiesOf, ofInterest,
         isOfInterest, impliedCapability, CAPABILITY, ordinalOf, isAtLeast }
  from "../model/capability.js";
import { defineCapacity, resolve, groupValues, CapacityError }
  from "../model/capacity.js";
import { A, run, MapStore, ActionError, checkEventGenerator, classify }
  from "action-language";
import { copilotPair, assistantContribution, supersededSettings, DELEGABLE_ONTOLOGIES }
  from "../model/group.js";
import { userCapability } from "../vocabulary/user-capability.js";
import { exemplars, reference, blindSinceBirth, lowVisionContrast,
         lowVisionColour, keyboardOnly, handTremor,
         deaf, deafenedAsymmetric, multipleSclerosis,
         deafBlind, deafenedNotch, secondLanguage,
         switchScanning, eyeGazeALS, sipAndPuff,
         switchScanningWithBuddy, toeTypist, oneHanded } from "../vocabulary/profiles.js";

let pass = 0, fail = 0;
const ok = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};
const throws = (label, Kind, fn) => {
  try { fn(); console.log(`  FAIL  ${label} (expected a throw)`); fail++; }
  catch (e) {
    if (e instanceof Kind) { console.log(`  PASS  ${label}\n        -> ${e.message.split("\n")[0]}`); pass++; }
    else { console.log(`  FAIL  ${label} (wrong error: ${e.name}: ${e.message})`); fail++; }
  }
};
const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const near = (a, b, what, tol = 1e-9) => {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: expected ~${b}, got ${a}`);
};

const props = Object.keys(userCapability.properties).length;
console.log(`capability: ${userCapability.id} v${userCapability.version}  ` +
  `ontologies=${Object.keys(userCapability.ontologies).length} properties=${props} ` +
  `templates=${Object.keys(userCapability.templates).length}\n`);

/* ------------------------------------------------------------------ */
/* The Action Language's own tests moved to the action-language repository when the
 * domains were split. Its builders are still imported below, because derived settings
 * and inference rules are written in them, but exercising the NOTATION is that
 * repository's job and doing it here as well would mean two places to update. */

console.log("\nCapability Model — every property is FULL / PARTIAL / NONE:");

ok("the scale is the model, not a per-property data type", () => {
  eq(CAPABILITY.join(","), "NONE,PARTIAL,FULL", "scale");
  /* focus carries no measurement at all — Table 3 gives its Values column as
   * the scale itself. focusDuration carries minutes, which qualify PARTIAL. */
  eq(userCapability.properties.focus.measurement, null, "focus has no measurement");
  eq(userCapability.properties.focusDuration.measurement.unit, "min", "focusDuration unit");
});

throws("declaring a property `type` is refused outright", CapabilityError, () =>
  defineCapability({
    id: "x", version: "1",
    ontologies: { visual: { description: "d" } },
    properties: { a: { ontology: "visual", type: "numeric", description: "d" } },
  }));

ok("subject ontologies are disjoint: every property has exactly one", () => {
  const counts = new Map();
  for (const o of Object.values(userCapability.ontologies)) {
    for (const p of o.properties) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  for (const [p, n] of counts) if (n !== 1) throw new Error(`${p} is in ${n} ontologies`);
  eq(counts.size, props, "every property placed");
});

ok("precedence may cross ontology boundaries (Table 4's readSignText pattern)", () => {
  const p = userCapability.properties.readFontText;
  eq(p.ontology, "language", "own ontology");
  const parents = p.precedence.map((n) => userCapability.properties[n].ontology);
  if (!parents.includes("visual")) throw new Error("expected a visual parent");
  if (!parents.includes("language")) throw new Error("expected a language parent");
});

ok("acquisition order puts every precedence parent before its children", () => {
  const at = new Map(userCapability.acquisitionOrder.map((n, i) => [n, i]));
  for (const [name, p] of Object.entries(userCapability.properties)) {
    for (const parent of p.precedence) {
      if (at.get(parent) >= at.get(name)) throw new Error(`${parent} comes after ${name}`);
    }
  }
});

console.log("\n'only of interest for PARTIAL sight' — read literally:");

ok("FULL parents make children uninteresting", () => {
  const all = { sight: "FULL", language: "FULL", hearing: "FULL" };
  if (isOfInterest(userCapability, "colorLow", (p) => all[p])) {
    throw new Error("colorLow should not be asked when sight is FULL");
  }
});

ok("NONE parents make children uninteresting too", () => {
  const none = { sight: "NONE" };
  if (isOfInterest(userCapability, "colorLow", (p) => none[p])) {
    throw new Error("colorLow should not be asked when sight is NONE");
  }
});

ok("PARTIAL is where the questions live", () => {
  const partial = { sight: "PARTIAL" };
  if (!isOfInterest(userCapability, "colorLow", (p) => partial[p])) {
    throw new Error("colorLow should be asked when sight is PARTIAL");
  }
});

ok("only NONE propagates — FULL is a heuristic, not an implication", () => {
  eq(impliedCapability(userCapability, "colorLow", () => "NONE"), "NONE", "NONE forces");
  eq(impliedCapability(userCapability, "colorLow", () => "FULL"), null, "FULL does not force");
  /* Tunnel vision is the case that breaks a strict ceiling: PARTIAL sight with
   * entirely FULL colour perception is coherent and must stay expressible. */
  eq(impliedCapability(userCapability, "colorLow", () => "PARTIAL"), null, "PARTIAL frees");
});

ok("an acquisition wizard is ofInterest() in a loop", () => {
  const asked = ofInterest(userCapability, { sight: "NONE", hearing: "FULL", language: "FULL",
                                             touch: "FULL", pointerControl: "FULL",
                                             keyControl: "FULL", effectorStability: "FULL" });
  if (asked.includes("colorLow")) throw new Error("must not ask about colour with no sight");
  if (asked.includes("minReadFontSizeForFont")) throw new Error("the paper's own example");
  if (!asked.includes("sight")) throw new Error("root properties are always asked");
});

ok("propertiesOf returns one ontology in acquisition order", () => {
  const sonic = propertiesOf(userCapability, "sonic");
  eq(sonic[0], "hearing", "hearing first");
});

throws("a property in an undeclared ontology is refused", CapabilityError, () =>
  defineCapability({
    id: "x", version: "1",
    ontologies: { visual: { description: "d" } },
    properties: { p: { ontology: "olfactory", description: "d" } },
  }));

throws("a precedence cycle is refused", CapabilityError, () =>
  defineCapability({
    id: "x", version: "1",
    ontologies: { v: { description: "d" } },
    properties: {
      a: { ontology: "v", description: "d", precedence: ["b"] },
      b: { ontology: "v", description: "d", precedence: ["a"] },
    },
  }));

throws("a numeric measurement without a unit is refused", CapabilityError, () =>
  defineCapability({
    id: "x", version: "1",
    ontologies: { v: { description: "d" } },
    properties: { a: { ontology: "v", description: "d",
                       measurement: { type: "numeric", min: 0, max: 1 } } },
  }));

throws("a composed collection without a CompositionOrder is refused", CapabilityError, () =>
  defineCapability({
    id: "x", version: "1",
    ontologies: { s: { description: "d" } },
    properties: { a: { ontology: "s", description: "d",
                       measurement: { type: "composite", of: { type: "numericRange", unit: "Hz" } } } },
  }));

/* ------------------------------------------------------------------ */
console.log("\nCapacity Model — a measurement qualifies PARTIAL and nothing else:");

ok("all eighteen exemplars build", () => {
  eq(Object.keys(exemplars).length, 18, "count");
  for (const [name, p] of Object.entries(exemplars)) {
    if (!p.entity.basis.startsWith("exemplar")) throw new Error(`${name} records no basis`);
  }
});

ok("the reference profile is seven settings, and that is the model working", () => {
  eq(Object.keys(reference.settings).length, 7, "settings");
  for (const s of Object.values(reference.settings)) {
    eq(s.capability, "FULL", `${s.id}`);
    eq(s.measurement, null, `${s.id} measurement`);
  }
});

throws("a measurement against FULL is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { sight: { capability: "PARTIAL" },
                contrastSensitivity: { capability: "FULL", measurement: 80 } },
  }));

throws("a measurement against NONE is refused — nothing there to measure", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { sight: { capability: "PARTIAL" },
                contrastSensitivity: { capability: "NONE", measurement: 0 } },
  }));

throws("PARTIAL without its measurement is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { sight: { capability: "PARTIAL" },
                contrastSensitivity: { capability: "PARTIAL" } },
  }));

ok("PARTIAL without a measurement is fine when the property declares none", () => {
  const m = defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { sight: { capability: "PARTIAL" }, focus: { capability: "PARTIAL" } },
  });
  eq(m.settings.focus.measurement, null, "blurred vision needs no number");
});

throws("a capability beneath a NONE parent is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { sight: { capability: "NONE" },
                colorLow: { capability: "PARTIAL", measurement: 50 } },
  }));

ok("a capability beneath a FULL parent is allowed — extra detail, not a contradiction", () => {
  const m = defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      language: { capability: "FULL" }, touch: { capability: "FULL" },
      hapticLanguageSet: { capability: "PARTIAL", measurement: ["Braille"] },
    },
  });
  eq(m.settings.hapticLanguageSet.measurement[0], "Braille", "braille recorded");
});

ok("the composite carries gaps — the paper's reason for the type", () => {
  const notched = defineCapacity(userCapability, {
    entity: { id: "notched", kind: "user", basis: "exemplar — test fixture" },
    settings: {
      hearing: { capability: "PARTIAL" },
      usableFrequencyRange: {
        capability: "PARTIAL",
        measurement: [{ from: 6000, to: 12000 }, { from: 100, to: 2000 }],
      },
    },
  });
  const bands = notched.settings.usableFrequencyRange.measurement;
  eq(bands.length, 2, "two bands");
  /* CompositionOrder lowestToHighest applied on declaration, so the
   * out-of-order declaration comes back sorted, with the gap intact. */
  eq(bands[0].from, 100, "sorted");
  eq(bands[1].from, 6000, "gap between 2000 and 6000 preserved");
});

ok("a composite tuple checks every named part", () => {
  eq(lowVisionContrast.settings.minReadFontSizeForFont.measurement.size, 18, "size");
  eq(lowVisionContrast.settings.minReadFontSizeForFont.measurement.font, "system-sans", "font");
});

throws("a composite tuple missing a part is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      sight: { capability: "PARTIAL" }, language: { capability: "FULL" },
      effectorStability: { capability: "FULL" }, readFontText: { capability: "PARTIAL" },
      minReadFontSizeForFont: { capability: "PARTIAL", measurement: { size: 14 } },
    },
  }));

throws("a discrete measurement outside its list is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { language: { capability: "FULL" }, keyControl: { capability: "FULL" },
                writeFontSet: { capability: "PARTIAL", measurement: ["SEMAPHORE"] } },
  }));

throws("an entity that is neither user nor group is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "robot" }, settings: { sight: { capability: "FULL" } },
  }));

throws("two settings for one property disagreeing on capability is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      sight: { capability: "PARTIAL" },
      a: { property: "contrastSensitivity", capability: "PARTIAL", measurement: 30 },
      b: { property: "contrastSensitivity", capability: "NONE" },
    },
  }));

throws("a derived setting that writes is refused — that is an Action", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      sight: { capability: "PARTIAL" },
      contrastSensitivity: { capability: "PARTIAL", measurement: 50 },
      colorLow: {
        capability: "PARTIAL",
        derived: { reads: ["contrastSensitivity"], cite: "bad",
                   formula: A.seq(A.write("contrastSensitivity", A.lit(10)), A.lit(50)) },
      },
    },
  }));

throws("a derived setting must be PARTIAL — only measurements derive", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      sight: { capability: "PARTIAL" },
      contrastSensitivity: { capability: "PARTIAL", measurement: 50 },
      colorLow: { capability: "FULL",
                  derived: { reads: ["contrastSensitivity"], cite: "c", formula: A.lit(50) } },
    },
  }));

throws("a cycle between derived settings is refused (OOA96 §9.1)", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      sight: { capability: "PARTIAL" },
      colorLow: { capability: "PARTIAL",
                  derived: { reads: ["colorHigh"], cite: "c", formula: A.measure("colorHigh") } },
      colorHigh: { capability: "PARTIAL",
                   derived: { reads: ["colorLow"], cite: "c", formula: A.measure("colorLow") } },
    },
  }));

/* ------------------------------------------------------------------ */
console.log("\nthe exemplars say what they should:");

ok("blind-since-birth is one changed line, and nothing is zeroed", () => {
  eq(blindSinceBirth.settings.sight.capability, "NONE", "sight");
  for (const gone of ["focus", "tracking", "colorLow", "contrastSensitivity",
                      "minReadFontSizeForFont", "viewRectangle"]) {
    if (blindSinceBirth.settings[gone]) throw new Error(`${gone} should not be recorded at all`);
  }
  eq(blindSinceBirth.settings.readFontText.capability, "NONE", "cannot read visually");
  eq(blindSinceBirth.settings.hearing.capability, "FULL", "hearing untouched");
  eq(blindSinceBirth.settings.hapticLanguageSet.measurement[0], "Braille", "braille");
});

ok("the two low-vision exemplars differ in the right dimension", () => {
  eq(lowVisionContrast.settings.contrastSensitivity.measurement, "strong", "contrast impaired");
  eq(lowVisionContrast.settings.colorMedium.capability, "FULL", "colour intact");
  eq(lowVisionColour.settings.colorMedium.measurement, "unreliable", "colour impaired");
  eq(lowVisionColour.settings.contrastSensitivity.capability, "FULL", "contrast intact");
});

/* The colour exemplar is a red-green pattern, and the POINT of it is that the
 * two are not equally affected. Mechanically banding the old percentages put
 * colorLow and colorMedium on the same scale point and flattened exactly the
 * distinction the profile exists to carry; this pins the shape so a future
 * migration cannot quietly do it again. */
ok("the colour exemplar keeps green worse than red, and blue unaffected", () => {
  const s = lowVisionColour.settings;
  eq(s.colorMedium.measurement, "unreliable", "green is the worst channel");
  eq(s.colorLow.measurement, "with-support", "red is impaired but usable");
  eq(s.colorHigh.measurement, "reliably", "blue carries");
});

ok("keyboard-only is a capability, not a preference", () => {
  eq(keyboardOnly.settings.pointerControl.capability, "NONE", "pointer");
  eq(keyboardOnly.settings.keyControl.capability, "FULL", "keys");
  eq(keyboardOnly.settings.writeFontSet.measurement[0], "SELECT", "writes by selection");
});

console.log("\nordered discrete scales — the groundwork for Likert (issue #8):");

/* A fixture alongside the real thing. Issue #8 is now DONE in the vocabulary —
 * the ten percentages are five ordered scales — but this keeps a scale whose
 * values differ from any real one, so the machinery is exercised independently
 * of whatever the vocabulary happens to say today. It also holds an UNORDERED
 * discrete scale (`signs`), because the interesting guarantee is that ranking
 * that one throws rather than inventing an order. */
const likertModel = defineCapability({
  id: "fixture.likert", version: "1",
  ontologies: { visual: { description: "d" }, language: { description: "d" } },
  properties: {
    sight: {
      ontology: "visual", description: "d",
      decides: "whether anything may be carried visually at all",
    },
    contrastNeed: {
      ontology: "visual", precedence: ["sight"], description: "d",
      decides: "how much contrast the interface must guarantee",
      measurement: {
        type: "discrete",
        ordered: true,
        values: [
          "no preference",
          "prefers more contrast",
          "needs strong contrast",
          "needs black on white",
        ],
      },
    },
    signs: {
      ontology: "language", description: "d",
      decides: "which sign languages may be rendered",
      measurement: { type: "discrete", values: ["ASL", "LSQ", "BSL"], multiple: true },
    },
  },
});

ok("an ordered scale carries rank by declared position", () => {
  const p = likertModel.properties.contrastNeed;
  eq(ordinalOf(p, "no preference"), 0, "first");
  eq(ordinalOf(p, "needs black on white"), 3, "last");
  eq(isAtLeast(p, "needs strong contrast", "prefers more contrast"), true, "above");
  eq(isAtLeast(p, "prefers more contrast", "needs strong contrast"), false, "below");
});

ok("ordinalOf returns a POSITION, never a percentage", () => {
  /* The whole point of issue #8: a Likert point is ordinal, not interval.
   * "position 2 of 4" is true; "50%" is a fabrication. */
  const p = likertModel.properties.contrastNeed;
  const r = ordinalOf(p, "needs strong contrast");
  eq(Number.isInteger(r), true, "an integer rank");
  if (r > 0 && r < 1) throw new Error("a fraction would be interval data we do not have");
});

throws("comparing an UNordered set is refused", CapabilityError, () =>
  ordinalOf(likertModel.properties.signs, "ASL"));

ok("unordered is the default, and signLanguageSet proves why", () => {
  /* ASL, LSQ and BSL are unrelated languages. Ranking them would be nonsense,
   * so `ordered` must be opt-in rather than assumed from list position. */
  eq(likertModel.properties.signs.measurement.ordered, false, "default is unordered");
  eq(userCapability.properties.signLanguageSet.measurement.ordered, false,
     "the real property too");
});

throws("a value not on the scale is refused", CapabilityError, () =>
  ordinalOf(likertModel.properties.contrastNeed, "quite bad"));

throws("duplicate values in a discrete list are refused", CapabilityError, () =>
  defineCapability({
    id: "x", version: "1",
    ontologies: { v: { description: "d" } },
    properties: { a: { ontology: "v", description: "d",
                       measurement: { type: "discrete", values: ["one", "one"] } } },
  }));

console.log("\nstress tests — the three profiles built to break the model:");

ok("Deaf: hearing NONE settles the whole sonic ontology", () => {
  eq(deaf.settings.hearing.capability, "NONE", "hearing");
  for (const gone of ["usableFrequencyRange", "azimuthResolution", "elevationResolution",
                      "binauralHearing", "concurrentStreams", "listeningDuration"]) {
    if (deaf.settings[gone]) throw new Error(`${gone} cannot exist beneath hearing: NONE`);
  }
  eq(deaf.settings.readAudioText.capability, "NONE", "cannot understand speech");
});

ok("Deaf: signs, and is not confused with DeafBlind", () => {
  eq(deaf.settings.signLanguageSet.measurement[0], "ASL", "signs ASL");
  eq(deaf.settings.readSignText.capability, "FULL", "reads sign");
  /* Braille has nothing to do with being Deaf. Reaching for "the other
   * accessibility thing" is exactly what capability modelling prevents. */
  if (deaf.settings.hapticLanguageSet) throw new Error("Deaf is not DeafBlind");
});

ok("readSignText is Table 4 verbatim: parents in two ontologies", () => {
  const p = userCapability.properties.readSignText;
  eq(p.precedence.join("+"), "sight+signLanguageSet", "the paper's own parent list");
  eq(userCapability.properties.sight.ontology, "visual", "one parent visual");
  eq(userCapability.properties.signLanguageSet.ontology, "language", "one parent language");
});

throws("Deaf: a sonic capability beneath hearing NONE is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: {
      hearing: { capability: "NONE" },
      azimuthResolution: { capability: "PARTIAL", measurement: 30 },
    },
  }));

ok("deafened: he can still HEAR the low end — with the good ear", () => {
  /* The correction that mattered. An earlier draft truncated the usable range
   * at 400 Hz, asserting he cannot hear bass at all. He can; what he has lost
   * is the second opinion on it. */
  const band = deafenedAsymmetric.settings.usableFrequencyRange.measurement[0];
  eq(band.from, 20, "low frequencies are audible");
  if (band.from > 100) throw new Error("truncating the range would claim deafness to bass");
});

ok("deafened: binaural hearing is a BAND, not a percentage", () => {
  const bin = deafenedAsymmetric.settings.binauralHearing.measurement[0];
  const usable = deafenedAsymmetric.settings.usableFrequencyRange.measurement[0];
  eq(deafenedAsymmetric.settings.binauralHearing.capability, "PARTIAL", "partial");
  eq(bin.from, 800, "the two ears combine only above the crossover");
  /* Below the crossover he hears but does not combine: the binaural band must
   * sit strictly inside the audible range. */
  if (bin.from <= usable.from) {
    throw new Error("binaural band should start above the audible range's floor");
  }
  if (bin.to > usable.to) throw new Error("cannot combine ears where he cannot hear");
});

ok("deafened: the voice pitch that WORKS is recorded, and the reason is not", () => {
  /* From Bob's CNIB Library borrowing data: older men chose female narrators.
   * The model records the band that works and stays silent on mechanism —
   * whether the lower register is reduced or so well preserved that it masks
   * upward, the renderer does the same thing either way: pick a higher voice. */
  const band = deafenedAsymmetric.settings.intelligibleVoicePitch.measurement;
  eq(band.from, 165, "female-range fundamentals work");
  if (band.from < 120) throw new Error("a male-range fundamental would not be the finding");
  /* Directly actionable: this selects a synthetic voice. */
  const spec = userCapability.properties.intelligibleVoicePitch.measurement;
  eq(spec.unit, "Hz", "a talker fundamental, not a percentage of anything");
  eq(userCapability.properties.intelligibleVoicePitch.precedence.join(","), "readAudioText",
     "only of interest if he understands speech at all");
});

ok("every profile records capability, never a deficit, in its prose too", () => {
  /* Bob's rule: we record what a person can hear, not what they cannot. The
   * measurements were always positive; this guards the descriptions, which are
   * what a reader actually remembers. */
  const banned = /\b(suffers|afflicted|victim|impaired by|crippl|wheelchair.bound|normal (?:user|person))\b/i;
  for (const [name, p] of Object.entries(exemplars)) {
    if (banned.test(p.entity.description)) {
      throw new Error(`${name} description uses deficit language: "${p.entity.description}"`);
    }
  }
});

ok("deafened: azimuth degrades but does not collapse; elevation is untouched", () => {
  const az = deafenedAsymmetric.settings.azimuthResolution.measurement;
  const el = deafenedAsymmetric.settings.elevationResolution.measurement;
  eq(az, 45, "coarse but usable — interaural LEVEL differences survive above 800 Hz");
  eq(el, 40, "monaural pinna cue, unaffected");
  if (az < el) throw new Error("azimuth should be no better than elevation here");
  if (az > 90) throw new Error("azimuth should not collapse entirely — ILD still works");
});

ok("azimuth depends on binaural hearing; elevation deliberately does not", () => {
  eq(userCapability.properties.azimuthResolution.precedence.includes("binauralHearing"), true,
     "azimuth needs two ears");
  eq(userCapability.properties.elevationResolution.precedence.includes("binauralHearing"), false,
     "elevation is a monaural pinna cue and must survive single-sided loss");
});

ok("DeafBlind: knowing a language does NOT require the eyes to receive it", () => {
  /* The bug this profile exposed. signLanguageSet had `sight` as a precedence
   * parent, so under sight: NONE the model refused to let a DeafBlind signer
   * know ASL at all — contradicting the most important fact about them. */
  eq(deafBlind.settings.sight.capability, "NONE", "no usable sight");
  eq(deafBlind.settings.signLanguageSet.measurement[0], "ASL", "and still knows ASL");
  eq(userCapability.properties.signLanguageSet.precedence.join(","), "language",
     "knowledge of a language depends on language, not on a channel");
});

ok("DeafBlind: same language, different channel", () => {
  /* readSignText and readTactileSign are the two channels for one language.
   * Conflating them makes a system offer an ASL video to someone who cannot
   * see it. */
  eq(deafBlind.settings.readSignText.capability, "NONE", "cannot see sign");
  eq(deafBlind.settings.readTactileSign.capability, "FULL", "receives it hand-over-hand");
  eq(userCapability.properties.readSignText.precedence.join(","), "sight,signLanguageSet",
     "visual channel");
  eq(userCapability.properties.readTactileSign.precedence.join(","), "touch,signLanguageSet",
     "tactile channel");
});

ok("DeafBlind: text arrives by touch, in more than one script", () => {
  const scripts = deafBlind.settings.hapticLanguageSet.measurement;
  if (!scripts.includes("Braille")) throw new Error("expected Braille");
  if (!scripts.includes("DeafblindManual")) throw new Error("expected the two-handed manual");
  if (scripts.length < 2) throw new Error("DeafBlind readers commonly use several");
});

ok("DeafBlind: every visual and auditory channel is closed, touch is the whole surface", () => {
  for (const closed of ["readFontText", "readAudioText", "readSignText"]) {
    eq(deafBlind.settings[closed].capability, "NONE", closed);
  }
  eq(deafBlind.settings.touch.capability, "FULL", "touch intact");
  /* The finding, not the embarrassment: an audio-first demonstrator has nothing
   * to offer this person yet, and the model says so plainly. */
  if (deafBlind.settings.hearing.capability !== "NONE") throw new Error("hearing");
});

ok("reception is sensory, production is motor — the parents differ", () => {
  const P = userCapability.properties;
  /* Receiving depends on a sense. */
  eq(P.readTactileSign.precedence.includes("touch"), true, "reading sign by hand needs touch");
  eq(P.readSignText.precedence.includes("sight"), true, "reading sign by eye needs sight");
  /* Producing depends on hands. */
  eq(P.writeSignSet.precedence.includes("effectorStability"), true, "signing needs steady hands");
  eq(P.writeTactileSet.precedence.includes("effectorStability"), true, "spelling needs steady hands");
  /* And crucially, producing does NOT depend on the receiving sense. Signing
   * visually needs no tactile sense, so touch must not gate the whole property
   * — that would be the same over-constraining error as C7 and C8. */
  eq(P.writeSignSet.precedence.includes("touch"), false,
     "visual signing needs no tactile sense");
  /* Spelling onto someone else's hand DOES need touch: you cannot place letters
   * on a hand you cannot feel. */
  eq(P.writeTactileSet.precedence.includes("touch"), true,
     "spelling onto a hand needs to find that hand");
});

ok("a tremor can leave someone fluent at receiving and unable to deliver", () => {
  /* Bob's case. Touch intact, hands unsteady: reads the two-handed manual on
   * their own hand without difficulty, cannot spell it onto someone else's.
   * Before the read/write split this was inexpressible — the model had only
   * "knows the script" and would have implied both. */
  const m = defineCapacity(userCapability, {
    entity: { id: "tremor-signer", kind: "user", basis: "exemplar — test fixture" },
    settings: {
      language: { capability: "FULL" },
      touch: { capability: "FULL" },
      keyControl: { capability: "FULL" },
      kinaesthesia: { capability: "FULL" },
      effectorStability: { capability: "PARTIAL", measurement: "large-only" },
      hapticLanguageSet: { capability: "PARTIAL", measurement: ["DeafblindManual"] },
      signLanguageSet: { capability: "PARTIAL", measurement: ["ASL"] },
      /* Receives fine. */
      readTactileSign: { capability: "FULL" },
      /* Cannot deliver. */
      writeTactileSet: { capability: "NONE" },
      writeSignSet: { capability: "PARTIAL", measurement: ["Visual"] },
    },
  });
  eq(m.settings.readTactileSign.capability, "FULL", "receives");
  eq(m.settings.writeTactileSet.capability, "NONE", "cannot deliver");
  eq(m.settings.hapticLanguageSet.measurement[0], "DeafblindManual", "still knows the script");
  /* Three separate facts about one script: knows it, reads it, cannot write it. */
});

ok("deaf and DeafBlind differ in production, not only reception", () => {
  eq(deaf.settings.writeSignSet.measurement.join(","), "Visual", "signs to sighted people");
  eq(deafBlind.settings.writeSignSet.measurement.join(","), "Visual,Tactile",
     "signs both ways — normally formed, and hand-over-hand");
  if (deaf.settings.writeTactileSet) {
    throw new Error("Deaf profile has no tactile script to produce");
  }
});

ok("sign languages are named unambiguously, and codes are flagged as codes", () => {
  const vals = userCapability.properties.signLanguageSet.measurement.values;
  /* "ISL" denotes Irish, Indian AND Israeli Sign Language depending on source. */
  if (vals.includes("ISL")) throw new Error("ISL is ambiguous — name the language");
  if (!vals.includes("IrishSL")) throw new Error("expected the disambiguated form");
  /* ASL and LSQ are unrelated languages, not dialects — both matter in Canada. */
  for (const lang of ["ASL", "LSQ"]) {
    if (!vals.includes(lang)) throw new Error(`expected ${lang}`);
  }
  /* SSE is manually coded English, not a language; the description must say so
   * because a renderer has to treat it differently. */
  if (!/not a language|coded form of English/i.test(
        userCapability.properties.signLanguageSet.description)) {
    throw new Error("SSE's status as a code, not a language, must be documented");
  }
});

ok("MS: touch NONE, but kinaesthesia is a separate property that survives", () => {
  eq(multipleSclerosis.settings.touch.capability, "NONE", "no tactile sense");
  eq(multipleSclerosis.settings.kinaesthesia.capability, "PARTIAL", "proprioception partial");
  eq(multipleSclerosis.settings.kinaesthesia.measurement, "needs-watching", "and measured");
  /* The dissociation is the point: modelling proprioception under touch would
   * have made this profile inexpressible. */
  eq(userCapability.properties.kinaesthesia.precedence.length, 0, "not a child of touch");
  if (multipleSclerosis.settings.vibrationDetection) {
    throw new Error("vibrationDetection is beneath touch: NONE and cannot exist");
  }
});

ok("MS: double vision is focus PARTIAL and stereo NONE", () => {
  eq(multipleSclerosis.settings.focus.capability, "PARTIAL", "the paper's own gloss");
  eq(multipleSclerosis.settings.stereo.capability, "NONE", "diplopia is failure to fuse");
});

ok("MS: fatigue under a FULL parent — why FULL must not propagate", () => {
  /* Hearing is unimpaired and listening still tires him. Under the ceiling rule
   * first written (child <= parent) this would have been rejected as
   * incoherent. It is not incoherent, it is MS. */
  eq(multipleSclerosis.settings.hearing.capability, "FULL", "hearing unimpaired");
  eq(multipleSclerosis.settings.listeningDuration.measurement, 15, "and still tires");
});

ok("MS is spiky: capabilities at all three levels across four ontologies", () => {
  const s = multipleSclerosis.settings;
  const levels = new Set(Object.values(s).map((x) => x.capability));
  eq(levels.has("FULL") && levels.has("PARTIAL") && levels.has("NONE"), true, "all three");
  const ontologies = new Set(Object.values(s).map((x) => userCapability.properties[x.property].ontology));
  if (ontologies.size < 4) throw new Error(`expected 4+ ontologies, got ${[...ontologies]}`);
});

ok("minTargetSize needs three parents, one in another ontology", () => {
  const p = userCapability.properties.minTargetSize;
  eq(p.precedence.join(","), "pointerControl,effectorStability,kinaesthesia", "parents");
  eq(userCapability.properties.kinaesthesia.ontology, "haptic", "crosses from motor to haptic");
});

console.log("\nthe body, not just the hands:");

/* Effector entries are {site, side} tuples since one-handedness was added, so
 * they cannot be join()ed as bare strings. Asserting the side too is the point:
 * "head" and "head/midline" are different claims, and the second is the one the
 * model now makes. */
const effectors = (m) => m.map((e) => `${e.site}/${e.side}`).join(",");

ok("touch says WHERE, and unlisted sites are unimpaired", () => {
  const spec = userCapability.properties.touch.measurement;
  const parts = spec.of.parts.map((p) => p.name);
  eq(parts.join(","), "site,side,level", "a site, a side and a level per entry");
  /* Vibration white finger: fingertips gone, hands reduced, everything else
   * unlisted and therefore fine. Neither whole-body nor hands-only could say
   * this — the property has now been wrong in both directions. */
  const wf = deafenedNotch.settings.touch;
  eq(wf.capability, "PARTIAL", "not NONE — his back is fine");
  const sites = Object.fromEntries(wf.measurement.map((m) => [m.site, m.level]));
  eq(sites.fingertips, "none", "fingertips");
  eq(sites.hands, "reduced", "palm keeps enough to feel a buzz");
  if ("trunk" in sites) throw new Error("intact sites must not be enumerated");
});

ok("C4: sensation preserved above the injury, absent below", () => {
  const sites = sipAndPuff.settings.touch.measurement.map((m) => m.site);
  for (const gone of ["arms", "hands", "fingertips", "trunk", "legs", "feet", "toes"]) {
    if (!sites.includes(gone)) throw new Error(`${gone} should be listed as absent`);
  }
  /* Head and face unlisted, therefore intact — which is exactly the fact a
   * whole-body `touch: NONE` destroyed. */
  if (sites.includes("head") || sites.includes("face")) {
    throw new Error("head and face are preserved at C4 and must not be listed");
  }
});

ok("body sites are a SET, never a rank", () => {
  const spec = userCapability.properties.touch.measurement.of.parts
    .find((p) => p.name === "site");
  eq(spec.ordered, false, "sites have no order — a head is not more than a foot");
  const level = userCapability.properties.touch.measurement.of.parts
    .find((p) => p.name === "level");
  eq(level.ordered, true, "levels do: none < trace < reduced < full");
});

ok("a toe typist has FULL control, done with feet", () => {
  const s = toeTypist.settings;
  /* The capability is not diminished by the site. "PARTIAL" here means "the
   * sites are named", not "reduced" — and effectorStability is FULL. */
  eq(effectors(s.keyControl.measurement), "feet/both,toes/both", "types with feet");
  eq(effectors(s.pointerControl.measurement), "feet/both,toes/both", "points with feet");
  eq(s.effectorStability.capability, "FULL", "no less steady than a hand");
  /* And sensation lives where the person does. */
  const sites = Object.fromEntries(s.touch.measurement.map((m) => [m.site, m.level]));
  eq(sites.hands, "none", "no hands");
  if ("toes" in sites) throw new Error("toe sensation is intact and must not be listed");
});

ok("naming the effector is now compulsory for partial control", () => {
  /* Before this, `keyControl: PARTIAL` said nothing about what does the work.
   * A head switch and a toe are different design problems at the same count. */
  eq(effectors(switchScanning.settings.keyControl.measurement), "head/midline", "a head switch");
  eq(effectors(handTremor.settings.keyControl.measurement), "hands/both,fingertips/both", "hands");
  /* "One or more sites" is carried by the SHAPE, not by a `multiple` flag: the
   * measurement is a composite LIST whose entries are {site, side} composites.
   * The flag went away when effectors gained a side, and this assertion had
   * been reading `undefined` as a pass ever since — the suite was crashing
   * before it got here, so nobody found out. */
  const spec = userCapability.properties.keyControl.measurement;
  eq(spec.type, "composite", "a list of effectors");
  eq(spec.of.parts.map((p) => p.name).join(","), "site,side", "each entry names site and side");
});

ok("effectorStability is not named for hands", () => {
  /* Renamed from manualStability. A foot is an effector and so is a chin. */
  if (userCapability.properties.manualStability) {
    throw new Error("manualStability should be gone");
  }
  eq(!!userCapability.properties.effectorStability, true, "effectorStability exists");
  if (/\bhand's\b/.test(userCapability.properties.effectorStability.description)) {
    throw new Error("the description still assumes hands");
  }
});

ok("head range is asked separately from head control", () => {
  const P = userCapability.properties;
  eq(P.headRange.precedence.join(","), "headControl", "range hangs off control");
  const dirs = P.headRange.measurement.parts.map((p) => p.name);
  eq(dirs.join(","), "up,down,left,right", "four directions, because limits are asymmetric");
  /* Someone may point precisely within a narrow arc and be unable to look up at
   * all, and a screen outside that arc is unusable however good the pointing. */
  for (const d of P.headRange.measurement.parts) eq(d.unit, "deg", `${d.name} in degrees`);
});

ok("one-handedness is expressible, and the working side is named", () => {
  /* Previously the model did not merely fail at this — it asserted the
   * opposite. `{site: "hands", level: "none"}` claimed BOTH hands, and this
   * person's right hand feels perfectly well. */
  const s = oneHanded.settings;
  const works = s.keyControl.measurement;
  eq(works.every((e) => e.side === "right"), true, "works with the right hand");
  const feel = Object.fromEntries(s.touch.measurement.map((e) => [e.side + " " + e.site, e.level]));
  eq(feel["left fingertips"], "none", "left side affected");
  if ("right hands" in feel) throw new Error("the right hand is unimpaired and must not be listed");
});

ok("side is orthogonal to site, not a doubled list", () => {
  const site = userCapability.properties.touch.measurement.of.parts.find((p) => p.name === "site");
  const side = userCapability.properties.touch.measurement.of.parts.find((p) => p.name === "side");
  eq(site.values.includes("leftHand"), false, "no leftHand pseudo-site");
  eq(side.values.join(","), "left,right,both,midline", "a separate part");
  /* `both` must be stated rather than assumed — an unstated default is how
   * "hands" came to mean "both hands" silently in the first place. */
  eq(side.values.includes("both"), true, "the ordinary case is explicit");
});

ok("one-handed is not clumsy — a distinction the model must keep", () => {
  eq(oneHanded.settings.effectorStability.capability, "FULL", "the working hand is steady");
  eq(oneHanded.settings.simultaneousContacts.measurement, 5, "five, because one hand");
  eq(oneHanded.settings.textEntryRate.measurement, 22, "slower than two hands, far faster than scanning");
});

console.log("\nplaying as a pair — what a co-pilot can and cannot lend:");

ok("a pair is a group Entity, and the paper says group Entities exist", () => {
  eq(switchScanningWithBuddy.entity.kind, "group", "group");
  eq(switchScanningWithBuddy.entity.members.join("+"), "switch-scanning+reference", "two members");
  eq(switchScanningWithBuddy.entity.primary, "switch-scanning", "whose game it is");
});

ok("motor capability delegates: the assistant supplies hands and timing", () => {
  const lent = assistantContribution(switchScanningWithBuddy);
  for (const expected of ["pointerControl", "keyControl", "effectorStability"]) {
    if (!lent.includes(expected)) throw new Error(`assistant should supply ${expected}`);
  }
  /* And the pair can now do what the primary alone could not. */
  eq(switchScanningWithBuddy.settings.keyControl.capability, "FULL", "pair has full key control");
  eq(switchScanning.settings.keyControl.capability, "PARTIAL", "primary alone does not");
});

ok("perception does NOT delegate, and language must not", () => {
  const lent = assistantContribution(switchScanningWithBuddy);
  const P = userCapability.properties;
  for (const id of lent) {
    const ont = P[switchScanningWithBuddy.settings[id].property].ontology;
    eq(ont, "motor", `${id} is motor — only motor may be lent`);
  }
  eq(DELEGABLE_ONTOLOGIES.join(","), "motor", "motor and nothing else");
});

ok("a co-pilot rescues the switch user and would do NOTHING for DeafBlind", () => {
  /* The asymmetry is the whole finding. Co-piloting solves motor and timing
   * problems; it does not solve perceptual ones. */
  const rescued = copilotPair(userCapability, switchScanning, reference,
                              { id: "p1", description: "d" });
  eq(rescued.settings.keyControl.capability, "FULL", "switch user gains real-time input");

  const notRescued = copilotPair(userCapability, deafBlind, reference,
                                 { id: "p2", description: "d" });
  eq(notRescued.settings.sight.capability, "NONE", "sight cannot be lent");
  eq(notRescued.settings.hearing.capability, "NONE", "nor hearing");
  /* A buddy describing a falling piece is always describing where it WAS. */
});

ok("settings beneath a lent capability are marked superseded, not silently kept", () => {
  const gone = supersededSettings(switchScanningWithBuddy).map((s) => s.setting);
  for (const expected of ["switchSites", "activationTiming"]) {
    if (!gone.includes(expected)) throw new Error(`${expected} should be superseded`);
  }
  /* Unmarked, "needs a slow scan" would survive into the pair and a renderer
   * would slow everything down for nobody — the pair is not scanning at all. */
  const mark = switchScanningWithBuddy.provenance.activationTiming;
  eq(mark.supersededBy, "keyControl", "superseded by the lent parent");
  /* Marked and kept rather than deleted: it is still true of the primary. */
  if (!switchScanningWithBuddy.settings.activationTiming) {
    throw new Error("kept, because it still describes the primary");
  }
});

throws("a pair cannot be made from a pair", CapacityError, () =>
  copilotPair(userCapability, switchScanningWithBuddy, reference, { id: "x", description: "d" }));

console.log("\nalternative access — limitation in output, not in the senses:");

ok("all three vary only what the person can DO", () => {
  /* Every earlier profile varied a sense. These vary output alone, which is a
   * shape the model had never been asked for. */
  for (const p of [switchScanning, eyeGazeALS, sipAndPuff]) {
    eq(p.settings.sight.capability, "FULL", `${p.entity.id} sees`);
    eq(p.settings.hearing.capability, "FULL", `${p.entity.id} hears`);
    eq(p.settings.language.capability, "FULL", `${p.entity.id} understands`);
    eq(p.settings.pointerControl.capability, "NONE", `${p.entity.id} no hand pointing`);
  }
});

ok("switch: one site forces timed scanning; two would not", () => {
  eq(switchScanning.settings.switchSites.measurement, 1, "one reliable site");
  eq(switchScanning.settings.activationTiming.measurement, "needs a slow scan", "and slow");
  /* The two properties fail independently, which is why they are separate.
   * Scanning is timed single-switch or untimed two-switch, so a second site
   * would make the timing row irrelevant. */
  const P = userCapability.properties;
  eq(P.switchSites.precedence.join(","), "keyControl", "both hang off keyControl");
  eq(P.activationTiming.precedence.join(","), "keyControl", "and not off each other");
});

ok("switch: unclear speech says nothing about comprehension", () => {
  eq(switchScanning.settings.speechIntelligibility.measurement, "familiar listeners", "dysarthria");
  eq(switchScanning.settings.language.capability, "FULL", "and understands every word");
});

ok("ALS: sight is FULL while gaze control is not", () => {
  /* The split this profile exists to make. Filing gaze under vision would say
   * this person cannot see, taking every visual property down with it. */
  eq(eyeGazeALS.settings.sight.capability, "FULL", "vision unaffected");
  eq(eyeGazeALS.settings.gazeControl.capability, "PARTIAL", "ocular motor control is not");
  eq(userCapability.properties.gazeControl.ontology, "motor", "gaze control is MOTOR");
  eq(userCapability.properties.gazeControl.precedence.join(","), "sight",
     "depends on sight without being sight");
});

ok("ALS: motor neurons go, sensory neurons stay", () => {
  /* A model that assumed paralysis implies numbness would be wrong about this
   * whole population. */
  eq(eyeGazeALS.settings.effectorStability.capability, "NONE", "no movement");
  eq(eyeGazeALS.settings.touch.capability, "FULL", "full sensation");
});

ok("ALS: anarthria with language entirely intact", () => {
  eq(eyeGazeALS.settings.speech.capability, "NONE", "no speech");
  const en = eyeGazeALS.settings.knownLanguages.measurement.find((l) => l.tag === "en-CA");
  eq(en.speaking, "none", "cannot speak it");
  eq(en.reading, "native", "and reads it natively");
  eq(en.listening, "native", "and hears it natively");
  /* The distinction most often got wrong about locked-in and near-locked-in
   * users, and the one that matters most. */
});

ok("ALS: dwell tolerance is the number that decides usability", () => {
  eq(eyeGazeALS.settings.dwellTolerance.measurement, 2500, "slow eye movement");
  eq(eyeGazeALS.settings.gazeAccuracy.measurement, 3, "degrees");
  /* Published thresholds run 500-1000 ms; 2500 is the slow-movement case, and
   * a dwell interface built for 500 ms would be unusable here. */
  const spec = userCapability.properties.dwellTolerance.measurement;
  eq(spec.unit, "ms", "milliseconds");
  if (spec.max < 2500) throw new Error("the scale must reach the slow-movement case");
});

ok("sip-and-puff: two channels, and sensation by site", () => {
  eq(sipAndPuff.settings.headControl.capability, "FULL", "continuous pointing by head");
  eq(sipAndPuff.settings.breathControl.measurement, 4, "sip, puff, hard and soft");
  /* At C4 sensation is preserved above the injury and absent below. This test
   * previously asserted `touch: NONE`, which was the hands-only reading and was
   * false about his head and face — the assertion outlived the model twice. */
  eq(sipAndPuff.settings.touch.capability, "PARTIAL", "absent below the injury, not everywhere");
  eq(sipAndPuff.settings.speech.capability, "FULL", "C4 leaves the diaphragm working");
});

ok("no profile names a device — capability, not equipment", () => {
  /* "Uses sip-and-puff" is a configuration choice for the Preference Model.
   * "Produces four distinguishable breath signals" is a capability. Naming
   * equipment would rebuild the functional list the paper rejects. */
  const banned = /\b(sip.and.puff|eye.?tracker|head ?mouse|switch interface|AAC device|joystick)\b/i;
  for (const [name, p] of Object.entries(exemplars)) {
    if (banned.test(p.entity.description)) {
      throw new Error(`${name} names equipment: "${p.entity.description}"`);
    }
  }
});

ok("input fatigue is modelled for DOING, not only for perceiving", () => {
  /* focusDuration, trackingDuration and listeningDuration existed; nothing
   * covered input, yet fatigue is a primary limit for all three of these. */
  eq(switchScanning.settings.inputDuration.measurement, 20, "switch");
  eq(eyeGazeALS.settings.inputDuration.measurement, 15, "gaze — dwell is tiring");
  eq(sipAndPuff.settings.inputDuration.measurement, 45, "breath");
  eq(userCapability.properties.inputDuration.ontology, "motor", "a motor property");
});

console.log("\nspeech — four skills, rated separately:");

ok("knownLanguages rates listening, speaking, reading and writing apart", () => {
  const P = userCapability.properties.knownLanguages;
  const parts = P.measurement.of.parts.map((p) => p.name);
  eq(parts.join(","), "tag,listening,speaking,reading,writing", "the four standard skills");
  /* Each is an ordered fluency scale, not a percentage — issue #8's principle
   * applied at the point of design rather than retrofitted. */
  for (const skill of ["listening", "speaking", "reading", "writing"]) {
    const spec = P.measurement.of.parts.find((p) => p.name === skill);
    eq(spec.type, "discrete", `${skill} is a scale`);
    eq(spec.ordered, true, `${skill} is ordered`);
  }
});

ok("ESL: comprehension runs ahead of production", () => {
  const en = secondLanguage.settings.knownLanguages.measurement
    .find((l) => l.tag === "en-CA");
  const scale = userCapability.properties.knownLanguages.measurement.of.parts
    .find((p) => p.name === "listening");
  const rank = (v) => scale.values.indexOf(v);
  if (rank(en.listening) <= rank(en.speaking)) {
    throw new Error("second-language acquisition normally understands before it produces");
  }
  eq(en.listening, "fluent", "understands");
  eq(en.speaking, "conversational", "speaks less well");
  /* And the first language is still there, which "speaks English" erases. */
  const pa = secondLanguage.settings.knownLanguages.measurement.find((l) => l.tag === "pa");
  eq(pa.speaking, "native", "native in Punjabi");
});

ok("Deaf: full literacy, no listening — the asymmetry a single fact cannot hold", () => {
  const en = deaf.settings.knownLanguages.measurement.find((l) => l.tag === "en-CA");
  eq(en.reading, "fluent", "reads English fluently");
  eq(en.writing, "fluent", "writes it fluently");
  eq(en.listening, "none", "does not receive it aurally");
  /* "Knows English" would be true and useless. The four skills are what make
   * it actionable. */
});

ok("accent is not a speech impairment", () => {
  /* The ESL speaker's voice is fine. Modelling accent as impairment would be
   * the category error the whole model exists to avoid. */
  eq(secondLanguage.settings.speech.capability, "FULL", "nothing wrong with the voice");
  eq(secondLanguage.settings.speechIntelligibility.measurement, "most listeners",
     "and still not understood by everyone");
});

ok("machines and people are separate judges, and that is the point", () => {
  /* Deaf: understood by people who know him, not by ASR at all. */
  eq(deaf.settings.speechIntelligibility.measurement, "familiar listeners", "people manage");
  eq(deaf.settings.speechRecognisedByMachine.capability, "NONE", "machines do not");
  /* ESL: understood by most people, machines struggle. Same direction, and in
   * both cases a system that infers the machine figure from the human one
   * offers voice control and strands the user. */
  eq(secondLanguage.settings.speechRecognisedByMachine.measurement,
     "with frequent corrections", "machines struggle here too");
  const P = userCapability.properties;
  eq(P.speechIntelligibility.precedence.join(","), "speech", "both hang off speech");
  eq(P.speechRecognisedByMachine.precedence.join(","), "speech", "and neither off the other");
});

ok("the ASR scale has no point that duplicates NONE", () => {
  const vals = userCapability.properties.speechRecognisedByMachine.measurement.values;
  for (const v of vals) {
    if (/^not usable$|^none$/i.test(v)) {
      throw new Error(`"${v}" duplicates the NONE capability — two ways to say one thing`);
    }
  }
  eq(vals[vals.length - 1], "reliably", "ordered least to most capable");
});

ok("a capability model that only describes disabled people is not one", () => {
  /* second-language has no sensory or motor limitation at all. Its presence is
   * the claim that this is capability modelling rather than disability
   * modelling with better manners. */
  for (const root of ["sight", "hearing", "touch", "pointerControl", "keyControl"]) {
    eq(secondLanguage.settings[root].capability, "FULL", root);
  }
  if (Object.keys(secondLanguage.settings).length < 8) {
    throw new Error("and it still carries real, actionable capability information");
  }
});

console.log("\nthe 4 kHz notch — a GAP, which is why Composite Property exists:");

ok("the notch is two bands with nothing usable between", () => {
  const bands = deafenedNotch.settings.usableFrequencyRange.measurement;
  eq(bands.length, 2, "two bands");
  eq(bands[0].to, 3000, "hearing stops at 3 kHz");
  eq(bands[1].from, 6000, "and resumes at 6 kHz");
  /* The gap is the whole justification for the type. A single min and max
   * would say 20-12000 and silently claim he hears 4 kHz, which he does not. */
  if (bands[0].to >= bands[1].from) throw new Error("no gap — this needs no composite");
});

ok("a gap is a silent failure, not a quiet one — 4 kHz is simply not received", () => {
  const bands = deafenedNotch.settings.usableFrequencyRange.measurement;
  const audible = (hz) => bands.some((b) => hz >= b.from && hz <= b.to);
  eq(audible(1000), true, "1 kHz fine");
  eq(audible(4000), false, "4 kHz never arrives");
  eq(audible(8000), true, "8 kHz fine again");
  /* This is the case a single range cannot express, and the case where
   * "put the cue at 4 kHz" fails without anyone noticing. */
});

ok("matched ears: the binaural band IS the usable band", () => {
  const u = deafenedNotch.settings.usableFrequencyRange.measurement;
  const b = deafenedNotch.settings.binauralHearing.measurement;
  eq(JSON.stringify(b), JSON.stringify(u), "symmetric loss combines wherever it hears");
  /* Contrast deafened-asymmetric, where the two differ because the ears do. */
  const a = deafenedAsymmetric;
  if (JSON.stringify(a.settings.binauralHearing.measurement)
      === JSON.stringify(a.settings.usableFrequencyRange.measurement)) {
    throw new Error("asymmetric loss should NOT have binaural == usable");
  }
});

ok("the two deafened profiles fail in opposite directions", () => {
  /* Same top-level capability, opposite design consequences: one needs the
   * stereo image simplified, the other needs content moved out of a band. */
  eq(deafenedNotch.settings.hearing.capability, "PARTIAL", "both PARTIAL");
  eq(deafenedAsymmetric.settings.hearing.capability, "PARTIAL", "both PARTIAL");
  const notchAz = deafenedNotch.settings.azimuthResolution.measurement;
  const asymAz = deafenedAsymmetric.settings.azimuthResolution.measurement;
  if (notchAz >= asymAz) throw new Error("symmetric loss should localise BETTER");
  eq(deafenedNotch.settings.usableFrequencyRange.measurement.length, 2, "notch has a gap");
  eq(deafenedAsymmetric.settings.usableFrequencyRange.measurement.length, 1, "asymmetric does not");
});

console.log("\nvibration white finger — touch is the hands, and the cold matters:");

ok("fingertip loss is expressible without claiming whole-body numbness", () => {
  /* This property has been wrong in both directions. Whole-body made this
   * person inexpressible; hands-only made the toe typist inexpressible. Sites
   * fix both, and this assertion has now been rewritten twice to follow. */
  eq(deafenedNotch.settings.touch.capability, "PARTIAL", "his back is fine");
  const sites = Object.fromEntries(
    deafenedNotch.settings.touch.measurement.map((m) => [m.site, m.level]));
  eq(sites.fingertips, "none", "the fingertips are the loss");
  if (!/by body site/i.test(userCapability.properties.touch.description)) {
    throw new Error("touch must document that it records where");
  }
  eq(deafenedNotch.settings.vibrationDetection.capability, "NONE",
     "and no vibrotactile sense — which rules out haptic feedback as a substitute");
});

ok("cold is a capability trigger, not a comfort setting", () => {
  const warm = resolve(userCapability, deafenedNotch, { ambientTemperature: "WARM" });
  const cold = resolve(userCapability, deafenedNotch, { ambientTemperature: "COLD" });
  eq(warm.settings.minTargetSize.measurement, 12, "warm");
  eq(cold.settings.minTargetSize.measurement, 19, "cold — 1.6x, rounded");
  if (cold.settings.minTargetSize.measurement <= warm.settings.minTargetSize.measurement) {
    throw new Error("vibration white finger worsens in cold; targets must grow");
  }
});

ok("the second worked functional dependency, on a different influence", () => {
  /* handTremor derives from deviceStability, this one from ambientTemperature.
   * Two profiles, two triggers, one mechanism — which is what makes the
   * Capacity Model adaptive rather than a static profile store. */
  const cited = resolve(userCapability, deafenedNotch, { ambientTemperature: "COLD" })
    .trace.find((t) => t.derived === "minTargetSize");
  if (!cited?.cite) throw new Error("the (M) formula must cite itself");
  if (!/cold/i.test(cited.cite)) throw new Error("the citation should name the trigger");
});

console.log("\nfunctional dependency — the paper's own worked example:");

ok("hand tremor: mounted display uses the seated size", () => {
  const { settings } = resolve(userCapability, handTremor, { deviceStability: "MOUNTED" });
  eq(settings.minReadFontSizeForFont.measurement.size, 12, "mounted");
});

ok("hand tremor: hand-held display needs a larger size", () => {
  const { settings, trace } = resolve(userCapability, handTremor, { deviceStability: "HANDHELD" });
  /* 12pt x TARGET_FACTOR["unsteady"] = 24. Was 19.8, from 12 x (1 + (100-35)/100).
   * The number moved because the arithmetic went away: there is no straight line
   * between steadiness and target size to compute along, so the factor is now a
   * declared lookup that someone who has watched a shaking hand can correct. */
  eq(settings.minReadFontSizeForFont.measurement.size, 24, "handheld, factor 2.0");
  eq(settings.minReadFontSizeForFont.measurement.font, "system-sans", "font carried through");
  if (!trace.find((t) => t.derived === "minReadFontSizeForFont")?.cite) {
    throw new Error("the (M) formula was not cited in the trace");
  }
});

ok("the capability stays declared while the measurement derives", () => {
  eq(handTremor.settings.minReadFontSizeForFont.capability, "PARTIAL", "declared");
  eq(handTremor.settings.minReadFontSizeForFont.measurement, null, "no stored value");
});

ok("influences fall back to their declared default", () =>
  eq(resolve(userCapability, handTremor).settings.minReadFontSizeForFont.measurement.size, 12,
     "default is MOUNTED"));

throws("an undeclared influence is refused", CapacityError, () =>
  resolve(userCapability, handTremor, { gravity: "HIGH" }));

throws("an influence value outside its list is refused", CapacityError, () =>
  resolve(userCapability, handTremor, { deviceStability: "FLOATING" }));

ok("a profile with nothing to derive resolves unchanged", () => {
  const { settings, trace } = resolve(userCapability, reference);
  eq(settings.sight.capability, "FULL", "sight");
  eq(trace.length, 0, "no derivation, no actions");
});

console.log("\nsetting groups — contexts that share settings:");

ok("a group resolves only its own settings", () => {
  const { settings } = groupValues(userCapability, reference, "listening");
  eq(Object.keys(settings).length, 1, "one setting");
  if ("sight" in settings) throw new Error("sight is not in the listening group");
});

ok("a group survives its profile losing settings", () => {
  const g = keyboardOnly.groups.input;
  for (const sid of g.settings) {
    if (!keyboardOnly.settings[sid]) throw new Error(`dangling reference: ${sid}`);
  }
});

throws("a group naming an unknown setting is refused", CapacityError, () =>
  defineCapacity(userCapability, {
    entity: { id: "x", kind: "user" },
    settings: { sight: { capability: "FULL" } },
    groups: { g: { settings: ["sight", "nonesuch"] } },
  }));

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
