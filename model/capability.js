/* CISNA / MSIADU Capability Model.
 * ---------------------------------------------------------------------------
 * Part of the cradle: the User Profiling half of the Runtime System.
 *
 * THE SHAPE OF THE MODEL — read this before anything else
 *
 * A Capability is a hierarchy of Properties whose value is FULL, PARTIAL or
 * NONE. Where the value is PARTIAL, and only there, a measurement qualifies it.
 *
 * That is the whole structure, and the "Values" column of the paper's tables
 * is showing two different things depending on the row:
 *
 *   Table 3, focus          "FULL PARTIAL NONE"   the capability scale itself
 *   Table 3, focusDuration  "Time in minutes"     the PARTIAL measurement
 *   Table 2, colorLow       "Percentage"          the PARTIAL measurement
 *   Table 4, writeFontSet   "CURSIVE BLOCK SELECT" the PARTIAL measurement
 *
 * So focusDuration is not "a number". It is FULL (can focus indefinitely),
 * PARTIAL (can focus for N minutes), or NONE (cannot focus at all), and the
 * minutes exist only in the middle case. A user who cannot perceive contrast
 * has contrast NONE — not zero percent. Zero percent would be a measurement of
 * something that is not there.
 *
 * The consequence for the hierarchy is the sentence attached to `sight` in
 * Tables 1, 2 and 3:
 *
 *     "Remaining template properties only of interest for PARTIAL sight."
 *
 * Note that it says PARTIAL, not "not NONE". FULL sight makes the children
 * uninteresting too, because there is no impairment left to describe. A child
 * property is of interest exactly when its parent is PARTIAL — which gives the
 * model a clean ordering, NONE < PARTIAL < FULL, in which a child may never be
 * more capable than its least capable parent.
 *
 * MODEL PROVENANCE (design/DEMOS.md §6a)
 *
 *   MODEL SPECIFIES. Figure 2 of "User Capability in an Adaptive World"
 *   (Dodd, Green & Pearson, MSIADU'09, doi:10.1145/1631097.1631110): a Subject
 *   Ontology scopes many Properties; Property has five intrinsic sub-types
 *   (Boolean, Discrete, Numeric, Text, Numeric Range); a Composite Property
 *   collects Properties under a Composition Order; Precedence describes a
 *   hierarchy of importance; Properties group into Capability Templates, and
 *   Templates into Template Sets.
 *
 *   "Subject ontologies are disjoint, so individual properties exist in exactly
 *   one ontology." Precedence, by contrast, crosses ontologies freely — Table
 *   4's readSignText has parents "sight + signLanguageSet" — and a Property may
 *   sit in several precedence trees at once.
 *
 *   WHAT THIS MODEL IS NOT. It holds no user data. It is the schema: what can
 *   be known about a person, not what is known about anyone. Values live in the
 *   Capacity Model (capacity.js).
 *
 *   THE DEFINITION THAT GOVERNS. "It is what the user can do, not why she
 *   cannot." Compare Table 1 (etiological: monochromacy TRUE/FALSE, protanopia
 *   TRUE/FALSE) with Table 2 (capability: colour perception per frequency band).
 *   The paper's verdict on the alternative is that "a model of specific
 *   solutions for specific conditions is unwieldy and unquantifiable".
 */

export class CapabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "CapabilityError";
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
  }
  return value;
}

/** The capability scale. Ordered: a child may not exceed its parent. */
export const CAPABILITY = Object.freeze(["NONE", "PARTIAL", "FULL"]);

const RANK = Object.freeze({ NONE: 0, PARTIAL: 1, FULL: 2 });

/** Lower is less capable. Used to derive a child's ceiling from its parents. */
export function rankOf(value) {
  if (!(value in RANK)) throw new CapabilityError(`not a capability value: ${value}`);
  return RANK[value];
}

/** The five intrinsic data types of Figure 2, plus composite. These type the
 *  PARTIAL *measurement*, never the capability itself. */
export const MEASUREMENT_TYPES = Object.freeze([
  "boolean",
  "discrete",
  "numeric",
  "numericRange",
  "text",
  "composite",
]);

/* ---------------------------------------------------------------------------
 * Measurement specifications
 * ------------------------------------------------------------------------- */

function normaliseMeasurement(spec, where) {
  if (spec === null || spec === undefined) return null;
  if (typeof spec !== "object") throw new CapabilityError(`${where}: measurement must be an object`);
  if (!MEASUREMENT_TYPES.includes(spec.type)) {
    throw new CapabilityError(
      `${where}: measurement type "${spec.type}"; expected one of ${MEASUREMENT_TYPES.join(", ")}`,
    );
  }

  const m = { type: spec.type, unit: spec.unit ?? null };

  switch (spec.type) {
    case "boolean":
      break;

    case "discrete":
      if (!Array.isArray(spec.values) || spec.values.length < 2) {
        throw new CapabilityError(`${where}: discrete measurement needs at least two values`);
      }
      if (new Set(spec.values).size !== spec.values.length) {
        throw new CapabilityError(`${where}: discrete values must be distinct`);
      }
      m.values = Object.freeze([...spec.values]);
      /* Discrete measurements may be answered with a set rather than a single
       * value — Table 4's writeFontSet is literally named a *Set*, and a user
       * may write in more than one mode. */
      m.multiple = spec.multiple ?? false;
      /* ORDERED, and deliberately opt-in.
       *
       * A discrete list makes no promise about rank by default, and it must not:
       * signLanguageSet holds ASL, LSQ, BSL, which are unrelated languages with
       * no order whatever. Comparing them would be meaningless and asserting an
       * order would be worse than meaningless.
       *
       * Some discrete measurements ARE ranked, and a Likert scale is the case
       * this exists for (issue #8). Where `ordered` is set, position in the
       * `values` array carries rank — first is least capable, last is most — and
       * `ordinalOf` and `isAtLeast` become available.
       *
       * NOT rejected in combination with `multiple`, though a Likert response is
       * a single choice. "Which of these levels have you experienced" is a
       * coherent question, and this project has already made the mistake of
       * forbidding combinations that sounded implausible and turned out to
       * describe real people (C7, C8, C8b). */
      m.ordered = spec.ordered ?? false;
      if (typeof m.ordered !== "boolean") {
        throw new CapabilityError(`${where}: ordered must be true or false`);
      }
      break;

    case "numeric":
      if (typeof spec.min !== "number" || typeof spec.max !== "number") {
        throw new CapabilityError(`${where}: numeric measurement needs min and max`);
      }
      if (spec.min > spec.max) throw new CapabilityError(`${where}: min > max`);
      if (!spec.unit) {
        /* Every numeric in the paper's tables is dimensioned — percentage,
         * minutes, points, milliseconds, pixels, Hertz. A bare number in a
         * profile survives one context and breaks in the next. */
        throw new CapabilityError(`${where}: numeric measurement needs a unit`);
      }
      m.min = spec.min;
      m.max = spec.max;
      break;

    case "numericRange":
      if (!spec.unit) throw new CapabilityError(`${where}: numericRange measurement needs a unit`);
      m.min = spec.min ?? null;
      m.max = spec.max ?? null;
      break;

    case "text":
      m.maxLength = spec.maxLength ?? null;
      break;

    case "composite":
      /* Two shapes, both present in the paper.
       *
       * `of` — a homogeneous collection, any length, with a Composition Order.
       * The paper's own example: "the usable audio frequency range for a user,
       * which may be described as a collection of numeric ranges measured in
       * Hertz, with gaps between the ranges. Formalization by the
       * CompositionOrder element allows for a natural order to be applied…
       * ordering the usable frequency ranges from lowest to highest."
       *
       * `parts` — MY CHOICE. A named tuple, for Table 4's
       * "Font size in points + font name", which is one measurement with two
       * components rather than a collection of like things. */
      if (spec.of && spec.parts) {
        throw new CapabilityError(`${where}: composite takes either of or parts, not both`);
      }
      if (spec.of) {
        m.of = normaliseMeasurement(spec.of, `${where} (composed part)`);
        m.order = spec.order ?? null;
        if (!m.order) {
          throw new CapabilityError(
            `${where}: a composed collection needs an order (the model's CompositionOrder; ` +
              `"lowest to highest" is the paper's example)`,
          );
        }
      } else if (Array.isArray(spec.parts) && spec.parts.length > 1) {
        m.parts = Object.freeze(
          spec.parts.map((p) => {
            if (!p.name) throw new CapabilityError(`${where}: every composite part needs a name`);
            return Object.freeze({ name: p.name, ...normaliseMeasurement(p, `${where}.${p.name}`) });
          }),
        );
        m.order = spec.order ?? "asDeclared";
      } else {
        throw new CapabilityError(`${where}: composite needs of, or parts with at least two entries`);
      }
      break;
  }

  return Object.freeze(m);
}

function normaliseDecides(spec, name) {
  if (!spec) {
    throw new CapabilityError(
      `property ${name} needs \`decides\`: what does a system DO differently knowing ` +
        `this? If nothing, it is a medical observation and does not belong in a model ` +
        `of interaction. Use { what, with: [...] } where it only contributes`,
    );
  }
  const what = typeof spec === "string" ? spec : spec.what;
  const withOthers = typeof spec === "string" ? [] : (spec.with ?? []);
  if (!what || typeof what !== "string") {
    throw new CapabilityError(`property ${name}: decides.what must name the decision`);
  }
  if (!Array.isArray(withOthers)) {
    throw new CapabilityError(`property ${name}: decides.with must be a list of properties`);
  }
  return Object.freeze({
    what,
    with: Object.freeze([...withOthers]),
    /* A property that needs others is making a weaker and more honest claim. */
    contributesOnly: withOthers.length > 0,
  });
}

/* ---------------------------------------------------------------------------
 * Declaration
 * ------------------------------------------------------------------------- */

/**
 * Declare a Capability Model.
 *
 * Each property is `{ontology, precedence, description, measurement?}`. There
 * is no `type`: every property is FULL/PARTIAL/NONE. `measurement` describes
 * what qualifies the PARTIAL case, and is omitted where PARTIAL needs no
 * further detail.
 */
export function defineCapability(spec) {
  if (!spec || typeof spec !== "object") {
    throw new CapabilityError("defineCapability needs a spec object");
  }
  const { id, version, ontologies, properties, templates = {}, templateSets = {} } = spec;
  if (!id) throw new CapabilityError("capability model needs an id");
  if (!version) throw new CapabilityError("capability model needs a version");
  if (!ontologies || !Object.keys(ontologies).length) {
    throw new CapabilityError("capability model needs at least one subject ontology");
  }
  if (!properties || !Object.keys(properties).length) {
    throw new CapabilityError("capability model needs at least one property");
  }

  const ontologyNames = new Set(Object.keys(ontologies));
  const propertyNames = new Set(Object.keys(properties));

  const builtOntologies = {};
  for (const [name, o] of Object.entries(ontologies)) {
    if (!o?.description) throw new CapabilityError(`ontology ${name} needs a description`);
    builtOntologies[name] = {
      name,
      description: o.description,
      /* The paper scopes ontologies to Nesbitt's physical design spaces but
       * says other groupings are possible: "it is possible to imagine other
       * groupings, not related to specific design spaces, with use of language
       * one obvious candidate". This records which kind each one is. */
      designSpace: o.designSpace ?? false,
      properties: [],
    };
  }

  const built = {};
  for (const [name, p] of Object.entries(properties)) {
    if (!p || typeof p !== "object") {
      throw new CapabilityError(`property ${name} must be an object`);
    }
    if ("type" in p) {
      throw new CapabilityError(
        `property ${name} declares a type. Properties have no type: every property is ` +
          `FULL/PARTIAL/NONE. Use \`measurement\` to type the PARTIAL case`,
      );
    }
    if (!p.ontology) throw new CapabilityError(`property ${name} declares no subject ontology`);
    if (!ontologyNames.has(p.ontology)) {
      throw new CapabilityError(
        `property ${name} is in ontology "${p.ontology}", which is not declared`,
      );
    }
    if (!p.description) throw new CapabilityError(`property ${name} needs a description`);
    /* REQUIRED, and it is what stops the model drifting into anatomy.
     *
     * This model exists to describe how a person can interact with a system, not
     * to describe a person. Every property must therefore name a decision that
     * some renderer, input handler or content selector actually makes. A
     * property that cannot name one is a medical observation with a schema
     * around it, and does not belong here however true it is.
     *
     * An audit on 2026-07-28 found 41 of 57 properties describing a person
     * without stating what a system would do about it. Making the field
     * mandatory is what stops that recurring, because it fails at declaration
     * rather than being noticed a year later.
     *
     * BUT A PROPERTY RARELY DECIDES ALONE, and pretending otherwise would just
     * produce 57 overstated claims. `contrastSensitivity` decides nothing by
     * itself; it sets the palette together with the six colour and intensity
     * bands. `gazeAccuracy` sets no target size until it is read with
     * `minTargetSize`. So a property may declare either:
     *
     *     decides: "the smallest a control may be drawn"
     *     decides: { what: "the palette", with: ["colorLow", "colorMedium"] }
     *
     * The second form says this property CONTRIBUTES to a decision that needs
     * others to complete. `contributesOnly` then falls out of whether `with` is
     * populated, and `decisionGroups()` can report which properties must be read
     * together. */
    const decides = normaliseDecides(p.decides, name);

    built[name] = {
      name,
      ontology: p.ontology,
      description: p.description,
      decides,
      /* Precedence parents — the paper's "parent" column. Zero, one, or many:
       * "Properties may sometimes appear in multiple precedence trees". */
      precedence: Object.freeze([...(p.precedence ?? [])]),
      measurement: normaliseMeasurement(p.measurement ?? null, `property ${name}`),
    };
    builtOntologies[p.ontology].properties.push(name);
  }

  for (const prop of Object.values(built)) {
    for (const other of prop.decides.with) {
      if (!propertyNames.has(other)) {
        throw new CapabilityError(
          `property ${prop.name} decides with "${other}", which is not declared`,
        );
      }
      if (other === prop.name) {
        throw new CapabilityError(`property ${prop.name} cannot decide with itself`);
      }
    }
    for (const parent of prop.precedence) {
      if (!propertyNames.has(parent)) {
        throw new CapabilityError(
          `property ${prop.name} has precedence parent "${parent}", which is not declared`,
        );
      }
    }
  }

  detectCycle(built);

  const builtTemplates = {};
  for (const [name, t] of Object.entries(templates)) {
    if (!Array.isArray(t?.properties) || !t.properties.length) {
      throw new CapabilityError(`template ${name} needs a properties list`);
    }
    for (const p of t.properties) {
      if (!propertyNames.has(p)) {
        throw new CapabilityError(`template ${name} lists "${p}", which is not declared`);
      }
    }
    builtTemplates[name] = {
      name,
      description: t.description ?? "",
      /* "The same Property may exist in many templates, again reflecting the
       * overlaps of Tables 1 to 4." No cross-template uniqueness. */
      properties: Object.freeze([...new Set(t.properties)]),
    };
  }

  const builtSets = {};
  for (const [name, s] of Object.entries(templateSets)) {
    if (!Array.isArray(s?.templates) || !s.templates.length) {
      throw new CapabilityError(`template set ${name} needs a templates list`);
    }
    for (const t of s.templates) {
      if (!builtTemplates[t]) {
        throw new CapabilityError(`template set ${name} lists template "${t}", not declared`);
      }
    }
    builtSets[name] = {
      name,
      description: s.description ?? "",
      templates: Object.freeze([...s.templates]),
    };
  }

  const model = {
    id,
    version,
    ontologies: builtOntologies,
    properties: built,
    templates: builtTemplates,
    templateSets: builtSets,
  };
  model.acquisitionOrder = Object.freeze(acquisitionOrder(built));
  return deepFreeze(model);
}

/* ---------------------------------------------------------------------------
 * Derived views
 * ------------------------------------------------------------------------- */

function detectCycle(properties) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(Object.keys(properties).map((k) => [k, WHITE]));
  const stack = [];
  const visit = (name) => {
    colour.set(name, GREY);
    stack.push(name);
    for (const next of properties[name].precedence) {
      if (colour.get(next) === GREY) {
        const from = stack.indexOf(next);
        throw new CapabilityError(
          `precedence cycle: ${[...stack.slice(from), next].join(" -> ")}`,
        );
      }
      if (colour.get(next) === WHITE) visit(next);
    }
    stack.pop();
    colour.set(name, BLACK);
  };
  for (const name of Object.keys(properties)) if (colour.get(name) === WHITE) visit(name);
}

/**
 * The order in which settings may sensibly be acquired: every precedence parent
 * before its children.
 *
 * The paper's argument for the Precedence element: "it makes no sense to
 * acquire a setting for 'minReadFontSizeForFont' if the user has no sight".
 */
export function acquisitionOrder(properties) {
  const out = [];
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const parent of properties[name].precedence) visit(parent);
    out.push(name);
  };
  /* Sorted for determinism: two runs must give the same order, or a diff of
   * two profiles becomes unreadable. */
  for (const name of Object.keys(properties).sort()) visit(name);
  return out;
}

/**
 * What a Property is *forced* to be by its precedence parents.
 *
 * Only NONE propagates. If a parent capability is absent, so is everything
 * beneath it: a user with no sight has no colour perception, and recording one
 * would be incoherent rather than merely uninformative.
 *
 * FULL does NOT propagate, and getting this wrong was a real error worth
 * recording. The paper's sentence is "Remaining template properties only of
 * interest for PARTIAL sight" — a statement about which questions are worth
 * asking, not a logical implication. Treating it as implication breaks
 * immediately: someone with tunnel vision has PARTIAL sight and may have
 * perfectly FULL colour perception, and a Braille reader has FULL language and
 * a very specific hapticLanguageSet. A child of a FULL parent is simply not
 * *interesting* by default; declaring one anyway is extra detail, not a
 * contradiction.
 *
 * @returns {"NONE"|null} the forced value, or null if the child is free
 */
export function impliedCapability(model, name, valueOf) {
  for (const parent of model.properties[name].precedence) {
    if (valueOf(parent) === "NONE") return "NONE";
  }
  return null;
}

/**
 * Is this Property worth asking about?
 *
 * Yes when it has no parents, or when no parent is NONE and at least one is
 * PARTIAL. That is the paper's rule read as what it says: FULL parents leave
 * nothing to describe, NONE parents leave nothing to describe, and PARTIAL is
 * where the detail lives.
 */
export function isOfInterest(model, name, valueOf) {
  const parents = model.properties[name].precedence;
  if (!parents.length) return true;
  let sawPartial = false;
  for (const parent of parents) {
    const v = valueOf(parent);
    if (v === "NONE") return false;
    if (v === "PARTIAL") sawPartial = true;
  }
  return sawPartial;
}

/**
 * Walk the model in acquisition order and report which properties are worth
 * asking about, given the answers so far. An acquisition wizard is this
 * function in a loop, and the paper's argument for Precedence existing at all:
 * "it makes no sense to acquire a setting for 'minReadFontSizeForFont' if the
 * user has no sight".
 */
export function ofInterest(model, values) {
  return model.acquisitionOrder.filter((n) => isOfInterest(model, n, (p) => values[p]));
}

/* ---------------------------------------------------------------------------
 * Ordered discrete measurements
 *
 * The rank of a value on a scale that declares itself ordered. Exists so that
 * adaptation logic can ask "is this at least X" without hard-coding the scale,
 * and so that a Likert response never has to be turned into a number to be
 * compared (issue #8).
 * ------------------------------------------------------------------------- */

function orderedSpec(property, fn) {
  const m = property?.measurement;
  if (!m || m.type !== "discrete") {
    throw new CapabilityError(`${fn}: ${property?.name} has no discrete measurement`);
  }
  if (!m.ordered) {
    throw new CapabilityError(
      `${fn}: ${property.name} is not an ordered scale. Comparing its values would ` +
        `assert a rank the model does not claim — set \`ordered: true\` if there is one`,
    );
  }
  return m;
}

/**
 * Rank of a value on an ordered scale: 0 is the first declared value.
 *
 * Deliberately returns position rather than a normalised fraction. A Likert
 * point is ordinal, not interval — "position 3 of 5" is true, "60%" is not, and
 * turning one into the other is the pseudo-precision issue #8 is about.
 */
export function ordinalOf(property, value) {
  const m = orderedSpec(property, "ordinalOf");
  const i = m.values.indexOf(value);
  if (i === -1) {
    throw new CapabilityError(
      `ordinalOf: "${value}" is not one of ${property.name}'s values (${m.values.join(", ")})`,
    );
  }
  return i;
}

/** Is `value` at or above `threshold` on an ordered scale? */
export function isAtLeast(property, value, threshold) {
  return ordinalOf(property, value) >= ordinalOf(property, threshold);
}

/**
 * Which properties must be read together to reach a decision.
 *
 * Groups by the decision named in `decides.what`, so a renderer can ask "what do
 * I need in order to set the palette" rather than inspecting properties one at a
 * time and guessing which combine.
 */
export function decisionGroups(model) {
  const groups = new Map();
  for (const [name, p] of Object.entries(model.properties)) {
    if (!groups.has(p.decides.what)) groups.set(p.decides.what, new Set());
    groups.get(p.decides.what).add(name);
    for (const other of p.decides.with) groups.get(p.decides.what).add(other);
  }
  return [...groups].map(([what, members]) => ({
    decision: what,
    properties: [...members].sort(),
    joint: members.size > 1,
  })).sort((a, b) => a.decision.localeCompare(b.decision));
}

/** Every property in one ontology, in acquisition order. */
export function propertiesOf(model, ontology) {
  if (!model.ontologies[ontology]) {
    throw new CapabilityError(`no such subject ontology: ${ontology}`);
  }
  return model.acquisitionOrder.filter((n) => model.properties[n].ontology === ontology);
}
