/* The Preference Model: what a person would RATHER, as against what they can do.
 * ---------------------------------------------------------------------------
 * A schema, not a profile. No user appears here.
 *
 * WHY THIS IS A SEPARATE MODEL AND NOT MORE CAPABILITY PROPERTIES
 *
 * Capability describes. It is an attempt to say what one person, or generically
 * an identified group of people, appears able to do, and it has no authority
 * beyond that attempt. Preference chooses. Conflating the two is the fault the
 * capability work objects to in AccessForAll: a profile saying "requires a
 * screen reader" records the accommodation and discards the reason, and the
 * reason was the part a system could have acted on.
 *
 * CAPABILITY DOES NOT BOUND PREFERENCE. Not a floor, not a ceiling, not a veto.
 * A person may want lower contrast, smaller text, or a channel that a profile
 * suggests will not serve them, and that is their choice. Bob's case, from his
 * master's research: a test subject with Multiple Sclerosis chose a cellphone
 * with neither the largest keys nor the largest text, but with blue backlit
 * keys and audio confirmation, because the illuminated characters were easier
 * to read given how the light changed through their own home. No model held the
 * backlighting or the room. A model that had refused that choice would have
 * been wrong AND overbearing.
 *
 * So nothing here clamps a preference to what capability suggests. Validation
 * refuses an invalid TYPE, never an unwelcome CHOICE.
 *
 * FOUR CATEGORIES, ONE KEY SPACE (Bob 2026-07-30)
 *
 * Preferences group into four kinds at descending levels of abstraction, and
 * they must be reachable in ONE consistent way regardless of which kind:
 *
 *   designSpace  which sense carries meaning at all   audio ahead of vision
 *   modality     which interaction channel is used    keyboard ahead of mouse
 *   perception   how it is presented within a channel blue on cream, 18pt
 *   tooling      which software, configured how       this reader, this rate
 *
 * Every preference therefore has an id, a category, a KIND, and something that
 * validates its value. Two kinds cover all four categories:
 *
 *   ranked  an ORDER over a domain, most preferred first. Partial by design:
 *           "audio ahead of vision" says nothing about tactile, and a person
 *           should not have to rank everything to state a preference about
 *           something. Unlisted is unranked, not rejected.
 *   valued  a single value, validated by a measurement spec — the same spec
 *           vocabulary the capability model uses, so a preference about font
 *           size is typed exactly as the capability it sits beside.
 *
 * `tooling` is deliberately loose. A tool is a solution, its settings are
 * open-ended, and any list of them trails whatever technology the person or
 * whoever profiled them happens to know about. That is tolerable HERE, where a
 * preference is a record of a choice, and was intolerable in a capability
 * model, where it masqueraded as a need.
 */

import { CapabilityError } from "./capability.js";

export class PreferenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreferenceError";
  }
}

/** The two shapes a preference value can take. */
export const PREFERENCE_KINDS = Object.freeze(["ranked", "valued"]);

/* Re-used from the capability model rather than reimplemented: a preference
 * about font size should be typed by exactly the same machinery as the
 * capability about font size, or the two drift. */
const MEASUREMENT_TYPES = Object.freeze([
  "boolean", "discrete", "numeric", "numericRange", "text", "composite",
]);

function checkMeasurementSpec(spec, where) {
  if (!spec || typeof spec !== "object") {
    throw new PreferenceError(`${where}: valued preference needs a measurement spec`);
  }
  if (!MEASUREMENT_TYPES.includes(spec.type)) {
    throw new PreferenceError(
      `${where}: measurement type "${spec.type}"; expected one of ${MEASUREMENT_TYPES.join(", ")}`,
    );
  }
  if (spec.type === "discrete") {
    if (!Array.isArray(spec.values) || spec.values.length < 2) {
      throw new PreferenceError(`${where}: discrete measurement needs at least two values`);
    }
  }
  if (spec.type === "numeric") {
    if (typeof spec.min !== "number" || typeof spec.max !== "number") {
      throw new PreferenceError(`${where}: numeric measurement needs min and max`);
    }
  }
  if (spec.type === "composite") {
    if (!Array.isArray(spec.parts) || !spec.parts.length) {
      throw new PreferenceError(`${where}: composite measurement needs named parts`);
    }
    for (const part of spec.parts) {
      if (!part?.name) throw new PreferenceError(`${where}: every composite part needs a name`);
      checkMeasurementSpec(part, `${where}.${part.name}`);
    }
  }
  return Object.freeze({ ...spec });
}

export function definePreference(spec) {
  if (!spec || typeof spec !== "object") {
    throw new PreferenceError("definePreference needs a spec object");
  }
  const { id, version, categories, preferences } = spec;
  if (!id) throw new PreferenceError("preference model needs an id");
  if (!version) throw new PreferenceError("preference model needs a version");
  if (!categories || !Object.keys(categories).length) {
    throw new PreferenceError("preference model needs at least one category");
  }
  if (!preferences || !Object.keys(preferences).length) {
    throw new PreferenceError("preference model needs at least one preference");
  }

  const categoryNames = new Set(Object.keys(categories));

  const builtCategories = {};
  for (const [name, c] of Object.entries(categories)) {
    if (!c?.description) throw new PreferenceError(`category ${name} needs a description`);
    builtCategories[name] = Object.freeze({ name, description: c.description, preferences: [] });
  }

  const built = {};
  for (const [name, p] of Object.entries(preferences)) {
    if (!p || typeof p !== "object") {
      throw new PreferenceError(`preference ${name} must be an object`);
    }
    if (!p.category) throw new PreferenceError(`preference ${name} declares no category`);
    if (!categoryNames.has(p.category)) {
      throw new PreferenceError(
        `preference ${name} names category "${p.category}", which is not declared`,
      );
    }
    if (!PREFERENCE_KINDS.includes(p.kind)) {
      throw new PreferenceError(
        `preference ${name}: kind "${p.kind}"; expected one of ${PREFERENCE_KINDS.join(", ")}`,
      );
    }
    if (!p.description) throw new PreferenceError(`preference ${name} needs a description`);

    const entry = {
      name,
      category: p.category,
      kind: p.kind,
      description: p.description,
      /* Which capability property this preference sits beside, where there is
       * one. NOT a constraint — it is how a renderer finds the pair so it can
       * notice a divergence, which is the only thing it may do about one. */
      qualifies: p.qualifies ?? null,
    };

    if (p.kind === "ranked") {
      if (!Array.isArray(p.domain) || p.domain.length < 2) {
        throw new PreferenceError(`preference ${name}: ranked preference needs a domain of at least two`);
      }
      if (new Set(p.domain).size !== p.domain.length) {
        throw new PreferenceError(`preference ${name}: domain values must be distinct`);
      }
      entry.domain = Object.freeze([...p.domain]);
      entry.measurement = null;
    } else {
      entry.domain = null;
      entry.measurement = checkMeasurementSpec(p.measurement, `preference ${name}`);
    }

    built[name] = Object.freeze(entry);
    builtCategories[p.category].preferences.push(name);
  }

  for (const c of Object.values(builtCategories)) Object.freeze(c.preferences);

  return Object.freeze({
    id,
    version,
    categories: Object.freeze(builtCategories),
    preferences: Object.freeze(built),
  });
}

/* --------------------------------------------------------------------------
 * Stated preferences: one person's answers against the schema
 * ------------------------------------------------------------------------ */

function checkValue(pref, value, where) {
  if (pref.kind === "ranked") {
    if (!Array.isArray(value)) {
      throw new PreferenceError(`${where}: ranked preference needs an array, most preferred first`);
    }
    if (new Set(value).size !== value.length) {
      throw new PreferenceError(`${where}: an order cannot list the same thing twice`);
    }
    for (const v of value) {
      if (!pref.domain.includes(v)) {
        throw new PreferenceError(
          `${where}: "${v}" is not one of ${pref.domain.join(", ")}`,
        );
      }
    }
    /* Deliberately NOT requiring every domain member to appear. A partial
     * order is the honest shape: "audio ahead of vision" is a complete
     * statement even where the person has no view about tactile. */
    return Object.freeze([...value]);
  }

  return checkAgainst(pref.measurement, value, where);
}

/** Validate one value against one measurement spec. Split out because a
 *  composite's PARTS are measurement specs too, and a tool's properties are
 *  exactly that: named parts with value types. Recursing means a tool setting
 *  is checked as strictly as a top-level preference. */
function checkAgainst(m, value, where) {
  const fail = (msg) => { throw new PreferenceError(`${where}: ${msg} (measurement type ${m.type})`); };
  switch (m.type) {
    case "boolean":
      if (typeof value !== "boolean") fail("expected true or false");
      return value;

    case "discrete": {
      /* `multiple` makes a discrete measurement a SET rather than a choice,
       * and sets are not orders. "Use visual and audio together" is a genuinely
       * different statement from "prefer visual, then audio", and a ranked
       * preference cannot express it: reading along with speech wants both
       * channels at once, not one as a fallback for the other. */
      if (m.multiple) {
        if (!Array.isArray(value)) fail("expected an array — this is a set");
        if (new Set(value).size !== value.length) fail("a set cannot list the same thing twice");
        for (const v of value) {
          if (!m.values.includes(v)) fail(`"${v}" is not one of ${m.values.join(", ")}`);
        }
        return Object.freeze([...value]);
      }
      if (!m.values.includes(value)) fail(`"${value}" is not one of ${m.values.join(", ")}`);
      return value;
    }

    case "numeric":
      if (typeof value !== "number" || Number.isNaN(value)) fail("expected a number");
      /* Range is a TYPE check on the scale, not a judgement about the choice:
       * a font size preference outside 4..96pt is a mistake, whereas a font
       * size the capability model thinks is too small is a decision. */
      if (typeof m.min === "number" && value < m.min) fail(`${value} is outside ${m.min}..${m.max}`);
      if (typeof m.max === "number" && value > m.max) fail(`${value} is outside ${m.min}..${m.max}`);
      return value;

    case "text":
      if (typeof value !== "string" || !value.length) fail("expected a non-empty string");
      return value;

    case "numericRange":
      if (value === null || typeof value !== "object") fail("expected an object");
      return Object.freeze({ ...value });

    case "composite": {
      /* A TOOL is a named thing with typed properties, which is what a
       * composite is. Every declared part is checked; an undeclared one is
       * refused, because a setting the tool does not have is a mistake rather
       * than an extension. Parts are OPTIONAL: naming a tool without setting
       * all of its knobs is the normal case. */
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("expected an object of named properties");
      }
      const parts = Object.fromEntries((m.parts ?? []).map((p) => [p.name, p]));
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (!parts[k]) {
          fail(`"${k}" is not a property of this${m.parts ? ` (${Object.keys(parts).join(", ")})` : ""}`);
        }
        out[k] = checkAgainst(parts[k], v, `${where}.${k}`);
      }
      return Object.freeze(out);
    }

    default:
      return fail("unsupported measurement type");
  }
}

/** One person's preferences, validated against a preference model.
 *
 *  Absence is meaningful and is the normal case: a person states preferences
 *  about the handful of things they care about, and everything else falls to
 *  selection rules.
 *
 *  PROVENANCE. A value here is either STATED, meaning the person said it, or
 *  INFERRED, meaning a rule worked it out from something they said. Both are
 *  the person's preferences — an inferred one is still user-driven, because
 *  its whole origin is a high-level choice they made — but they are not
 *  interchangeable, for two reasons:
 *
 *    1. An inference must never overwrite what somebody actually said. If they
 *       set a font size themselves, a rule inferring one from their channel
 *       preference has to leave it alone.
 *    2. When the high-level preference changes, the inferences drawn from it
 *       are stale and have to be drawn again. Nothing can tell which those
 *       were unless it was written down at the time.
 *
 *  So `values` holds the effective value whatever its origin, and `provenance`
 *  records where each came from. Same shape the co-pilot pairing already uses
 *  for lent capabilities. */
export function statePreferences(model, spec) {
  if (!model?.preferences) throw new PreferenceError("statePreferences needs a preference model");
  const { entity, values = {} } = spec ?? {};
  if (!entity?.id) throw new PreferenceError("stated preferences need an entity with an id");

  const out = {};
  const provenance = {};
  for (const [name, value] of Object.entries(values)) {
    const pref = model.preferences[name];
    if (!pref) {
      throw new PreferenceError(
        `stated preference "${name}" is not declared in the preference model`,
      );
    }
    out[name] = checkValue(pref, value, `preference ${name}`);
    provenance[name] = Object.freeze({ from: "stated", by: null });
  }

  return Object.freeze({
    model: model.id,
    modelRef: model,
    entity: Object.freeze({ ...entity }),
    values: Object.freeze(out),
    provenance: Object.freeze(provenance),
  });
}

/** Write an INFERRED preference, as a rule that read a higher-level one.
 *
 *  Returns a new preference set; the input is not mutated. Refuses to write
 *  over a STATED value and says so in the result, because "the rule would have
 *  chosen 14pt and the person had already asked for 18" is worth knowing and
 *  is not an error. Refuses an undeclared name and an invalid value outright,
 *  because those are modelling mistakes rather than disagreements. */
export function inferPreference(prefs, name, value, by = null) {
  const model = prefs?.modelRef;
  if (!model) throw new PreferenceError("inferPreference needs preferences built by statePreferences");
  const pref = model.preferences[name];
  if (!pref) {
    throw new PreferenceError(`inferred preference "${name}" is not declared in the preference model`);
  }
  const checked = checkValue(pref, value, `inferred preference ${name}`);

  if (prefs.provenance[name]?.from === "stated") {
    return Object.freeze({
      ...prefs,
      /* Unchanged. The person outranks the inference. */
      overruled: Object.freeze([...(prefs.overruled ?? []),
        Object.freeze({ preference: name, wouldHaveBeen: checked, by })]),
    });
  }

  return Object.freeze({
    ...prefs,
    values: Object.freeze({ ...prefs.values, [name]: checked }),
    provenance: Object.freeze({
      ...prefs.provenance,
      [name]: Object.freeze({ from: "inferred", by }),
    }),
    overruled: Object.freeze([...(prefs.overruled ?? [])]),
  });
}

/** Is there a value at all, from any source? The condition a SELECTION RULE
 *  fires on: no preference stated and none inferred, so something must decide. */
export function hasPreference(prefs, name) {
  return Boolean(prefs?.values && name in prefs.values);
}

/** Did the PERSON say this, as against a rule inferring it? The condition an
 *  INFERENCE tests, so it does not overwrite them. */
export function stated(prefs, name) {
  return prefs?.provenance?.[name]?.from === "stated";
}

/** Where a value came from: "stated", "inferred", or null if there is none. */
export function provenanceOf(prefs, name) {
  return prefs?.provenance?.[name]?.from ?? null;
}

/** The stated value, or null. */
export function valueOf(prefs, name) {
  return prefs?.values?.[name] ?? null;
}

/** Position of `item` in a ranked preference, 0 being most preferred, or null
 *  where the person did not rank it. Null is not "last": it is "no view", and a
 *  rule that treats the two the same is inventing an opinion. */
export function rankOf(prefs, name, item) {
  const v = prefs?.values?.[name];
  if (!Array.isArray(v)) return null;
  const i = v.indexOf(item);
  return i === -1 ? null : i;
}

export { CapabilityError };
