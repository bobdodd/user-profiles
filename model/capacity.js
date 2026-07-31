/* CISNA / MSIADU Capacity Model.
 * ---------------------------------------------------------------------------
 * Where a specific user's settings live, across multiple contexts.
 *
 * A Setting is a pair, because a Property is a pair:
 *
 *     { capability: "FULL" | "PARTIAL" | "NONE", measurement?: … }
 *
 * The measurement exists only when the capability is PARTIAL, and only when the
 * Property declares one. FULL means fully capable — nothing left to qualify.
 * NONE means the capability is absent — nothing there to measure. Recording
 * "contrast: 0%" instead of "contrast: NONE" asserts that a measurement was
 * taken of something that does not exist.
 *
 * MODEL PROVENANCE (design/DEMOS.md §6a)
 *
 *   MODEL SPECIFIES. Figure 3 of "User Capability in an Adaptive World"
 *   (MSIADU'09): an Entity relates to Capability Templates; Setting has the
 *   same sub-types as Property and maps directly onto it; Settings organise
 *   into Setting Groups through Setting In Group; Setting Group relates to
 *   Capability Template and, through Influenced Group, to External Influence;
 *   Action relates to Setting through Setting Access and to External Influence
 *   through Action Trigger.
 *
 *   Four statements govern the design, each easy to get wrong in a way that
 *   looks reasonable:
 *
 *   1. "Settings themselves refine the characteristics of an Entity. An entity
 *      is either a user, or a group of users." Not user-per-profile: a shared
 *      classroom machine is one Entity.
 *
 *   2. "The key difference between <context> and SettingGroup is that the same
 *      settings may appear in more than one group… the individual Setting is
 *      referenced in every case." A Setting is a first-class value holder with
 *      its own identity, referenced by groups — not a value stored inside a
 *      context. Copying values into contexts is the duplication §3 criticises.
 *
 *   3. "there is no requirement for there to be a Setting for every Property in
 *      the CapabilityTemplate". A partial group is well-formed.
 *
 *   4. "Functional dependency is expressed through Actions. An Action is a mini
 *      program that can read and write Settings. A single action may access
 *      many Settings. Actions trigger as a result of ExternalInfluences."
 *
 *   MODEL SPECIFIES (parent method) + OUR DECISION. Point 4 says "functionally
 *   dependent". OOA96 chapter 2 separates functional from *mathematical*
 *   dependence, and a measurement computed from other Settings by a stated
 *   formula is the latter: "given values of the attributes in X, the value of Y
 *   can be determined by a formula or algorithm" (§2.3). OOA96 marks such
 *   attributes (M) and requires the description to cite the formula.
 *
 *   Decision (DOMAINS.md §1b): derived Settings are (M)-marked and declarative;
 *   an Action is reserved for what genuinely processes. Note that only the
 *   *measurement* is derived — the capability is declared, because whether a
 *   user can read at all is not a function of how large the type is.
 *
 *   The (M) dependency graph is checked acyclic, per OOA96 §9.1.
 */

import { CapabilityError, rankOf, impliedCapability } from "./capability.js";
import { A, run, MapStore, classify, ActionError } from "action-language";

export class CapacityError extends Error {
  constructor(message) {
    super(message);
    this.name = "CapacityError";
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ---------------------------------------------------------------------------
 * Measurement checking
 * ------------------------------------------------------------------------- */

export function checkMeasurement(spec, value, where) {
  const fail = (msg) => {
    throw new CapacityError(`${where}: ${msg} (measurement type ${spec.type})`);
  };

  switch (spec.type) {
    case "boolean":
      if (typeof value !== "boolean") fail(`expected a boolean, got ${typeof value}`);
      return value;

    case "discrete": {
      if (spec.multiple) {
        if (!Array.isArray(value) || !value.length) fail("expected a non-empty array of values");
        for (const v of value) {
          if (!spec.values.includes(v)) fail(`"${v}" is not one of ${spec.values.join(", ")}`);
        }
        return Object.freeze([...value]);
      }
      if (!spec.values.includes(value)) {
        fail(`"${value}" is not one of ${spec.values.join(", ")}`);
      }
      return value;
    }

    case "numeric":
      if (typeof value !== "number" || Number.isNaN(value)) {
        fail(`expected a number, got ${JSON.stringify(value)}`);
      }
      if (value < spec.min || value > spec.max) {
        fail(`${value}${spec.unit} is outside ${spec.min}..${spec.max}${spec.unit}`);
      }
      return value;

    case "numericRange": {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected {from, to}");
      const { from, to } = value;
      if (typeof from !== "number" || typeof to !== "number") fail("range needs numeric from and to");
      if (from > to) fail(`range inverted: ${from} > ${to}`);
      if (spec.min !== null && from < spec.min) fail(`range starts below ${spec.min}${spec.unit}`);
      if (spec.max !== null && to > spec.max) fail(`range ends above ${spec.max}${spec.unit}`);
      return Object.freeze({ from, to });
    }

    case "text":
      if (typeof value !== "string") fail(`expected a string, got ${typeof value}`);
      if (spec.maxLength !== null && value.length > spec.maxLength) {
        fail(`text longer than ${spec.maxLength}`);
      }
      return value;

    case "composite":
      if (spec.of) {
        /* A collection. The paper's example is the usable audio frequency
         * range: "a collection of numeric ranges measured in Hertz, WITH GAPS
         * BETWEEN THE RANGES". The gaps are the point — notched hearing loss is
         * expressible, and would not be by a single min and max. */
        if (!Array.isArray(value) || !value.length) {
          fail("composed collection must be a non-empty array");
        }
        const parts = value.map((v, i) => checkMeasurement(spec.of, v, `${where} part ${i}`));
        return Object.freeze(applyCompositionOrder(parts, spec.order));
      }
      /* A named tuple. Table 4's "Font size in points + font name". */
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail(`expected an object with ${spec.parts.map((p) => p.name).join(", ")}`);
      }
      {
        const out = {};
        for (const part of spec.parts) {
          if (!(part.name in value)) fail(`missing part "${part.name}"`);
          out[part.name] = checkMeasurement(part, value[part.name], `${where}.${part.name}`);
        }
        for (const k of Object.keys(value)) {
          if (!spec.parts.some((p) => p.name === k)) fail(`unexpected part "${k}"`);
        }
        return Object.freeze(out);
      }

    default:
      fail("unknown measurement type");
  }
}

function applyCompositionOrder(parts, order) {
  const copy = [...parts];
  const key = (v) => (typeof v === "object" && v !== null && "from" in v ? v.from : v);
  if (order === "lowestToHighest") return copy.sort((a, b) => key(a) - key(b));
  if (order === "highestToLowest") return copy.sort((a, b) => key(b) - key(a));
  if (order === "asDeclared") return copy;
  throw new CapacityError(`unknown compositionOrder: ${order}`);
}

/**
 * Check one Setting against its Property.
 *
 * The capability/measurement pairing rules live here, and they are the heart of
 * the model: a measurement is present exactly when the capability is PARTIAL.
 */
export function checkSetting(property, setting, where) {
  const fail = (msg) => { throw new CapacityError(`${where}: ${msg}`); };

  const capability = setting?.capability;
  if (capability === undefined) {
    fail(`no capability given. Every setting is FULL, PARTIAL or NONE`);
  }
  rankOf(capability); /* throws CapabilityError if not one of the three */

  const hasMeasurement = setting.measurement !== undefined && setting.measurement !== null;

  if (capability !== "PARTIAL" && hasMeasurement) {
    fail(
      `capability is ${capability} but a measurement was given. A measurement qualifies ` +
        `PARTIAL only — ${capability === "NONE"
          ? "there is nothing there to measure"
          : "there is nothing left to qualify"}`,
    );
  }

  if (capability === "PARTIAL") {
    if (!property.measurement) {
      /* Legitimate: Table 3's `focus` is PARTIAL for blurred or double vision
       * and carries no measurement at all. */
      if (hasMeasurement) fail(`property ${property.name} declares no measurement`);
      return Object.freeze({ capability, measurement: null });
    }
    if (!hasMeasurement) {
      fail(
        `capability is PARTIAL but no measurement was given; property ${property.name} ` +
          `declares one (${property.measurement.type}${
            property.measurement.unit ? " in " + property.measurement.unit : ""})`,
      );
    }
    return Object.freeze({
      capability,
      measurement: checkMeasurement(property.measurement, setting.measurement, where),
    });
  }

  return Object.freeze({ capability, measurement: null });
}

/* ---------------------------------------------------------------------------
 * Declaration
 * ------------------------------------------------------------------------- */

export function defineCapacity(capability, spec) {
  if (!capability?.properties) {
    throw new CapacityError("defineCapacity needs a capability model as its first argument");
  }
  const { entity, settings, groups = {}, actions = {}, influences = {} } = spec ?? {};

  if (!entity?.id) throw new CapacityError("capacity model needs an entity with an id");
  if (entity.kind !== "user" && entity.kind !== "group") {
    throw new CapacityError(
      `entity kind must be "user" or "group" — the paper: "An entity is either a user, ` +
        `or a group of users"`,
    );
  }
  if (!settings || !Object.keys(settings).length) {
    throw new CapacityError("capacity model needs at least one setting");
  }

  const builtInfluences = {};
  for (const [name, inf] of Object.entries(influences)) {
    if (!inf?.description) throw new CapacityError(`influence ${name} needs a description`);
    builtInfluences[name] = Object.freeze({
      name,
      description: inf.description,
      values: inf.values ? Object.freeze([...inf.values]) : null,
      default: inf.default ?? null,
    });
  }

  const builtSettings = {};
  for (const [id, s] of Object.entries(settings)) {
    const propertyName = s?.property ?? id;
    const property = capability.properties[propertyName];
    if (!property) {
      throw new CapacityError(
        `setting ${id} refers to property "${propertyName}", which the capability model ` +
          `does not declare`,
      );
    }

    if (s?.derived) {
      const d = s.derived;
      if (s.capability !== "PARTIAL") {
        throw new CapacityError(
          `derived setting ${id} must declare capability PARTIAL. Only a measurement can ` +
            `be derived — whether a capability exists at all is not a function of its degree`,
        );
      }
      if (!property.measurement) {
        throw new CapacityError(
          `derived setting ${id}: property ${propertyName} declares no measurement, so ` +
            `there is nothing to derive`,
        );
      }
      if (!Array.isArray(d.reads) || !d.reads.length) {
        throw new CapacityError(
          `derived setting ${id} must declare what it reads — OOA96 §2.3 requires a ` +
            `dependent variable to cite its independent variables`,
        );
      }
      if (!d.formula) throw new CapacityError(`derived setting ${id} needs a formula`);
      if (!d.cite) {
        throw new CapacityError(
          `derived setting ${id} needs a cite: OOA96 §2.3 — "cite the formula or algorithm ` +
            `used to determine the value of the attribute"`,
        );
      }
      const shape = classify(d.formula);
      const writes = shape.accessors.filter((k) => ["write", "create", "delete"].includes(k));
      if (writes.length) {
        throw new CapacityError(
          `derived setting ${id} writes to the store (${writes.join(", ")}). A mathematically ` +
            `dependent value is computed, not assigned — use an Action instead`,
        );
      }
      builtSettings[id] = {
        id,
        property: propertyName,
        capability: "PARTIAL",
        measurement: null,
        derived: Object.freeze({
          reads: Object.freeze([...d.reads]),
          formula: d.formula,
          cite: d.cite,
          influences: Object.freeze([...(d.influences ?? [])]),
        }),
      };
      continue;
    }

    const checked = checkSetting(property, s, `setting ${id}`);
    builtSettings[id] = {
      id,
      property: propertyName,
      capability: checked.capability,
      measurement: checked.measurement,
      derived: null,
    };
  }

  /* A Setting may not be more capable than its Property's precedence parents
   * allow. NONE < PARTIAL < FULL, and a child cannot exceed its least capable
   * parent: a user with no sight cannot have partial colour perception.
   *
   * Parents are matched by property name, taking the first Setting that holds
   * them. Where a profile has several Settings for one Property (per-context
   * values), they must agree on capability for this to be meaningful — which
   * is checked below. */
  const byProperty = new Map();
  for (const s of Object.values(builtSettings)) {
    if (!byProperty.has(s.property)) byProperty.set(s.property, []);
    byProperty.get(s.property).push(s);
  }
  for (const [propertyName, group] of byProperty) {
    const distinct = new Set(group.map((s) => s.capability));
    if (distinct.size > 1) {
      throw new CapacityError(
        `settings ${group.map((s) => s.id).join(", ")} all describe property ` +
          `"${propertyName}" but disagree about its capability (${[...distinct].join(", ")}). ` +
          `Per-context values may differ; whether the capability exists may not`,
      );
    }
  }
  const valueOf = (name) => byProperty.get(name)?.[0]?.capability;
  for (const s of Object.values(builtSettings)) {
    const implied = impliedCapability(capability, s.property, valueOf);
    if (implied === "NONE" && s.capability !== "NONE") {
      const absent = capability.properties[s.property].precedence
        .filter((p) => valueOf(p) === "NONE")
        .join(", ");
      throw new CapacityError(
        `setting ${s.id} is ${s.capability}, but its precedence parent ${absent} is NONE. ` +
          `A capability cannot exist beneath one that does not`,
      );
    }
  }

  for (const s of Object.values(builtSettings)) {
    if (!s.derived) continue;
    for (const r of s.derived.reads) {
      if (!builtSettings[r]) {
        throw new CapacityError(`derived setting ${s.id} reads "${r}", which is not declared`);
      }
    }
    for (const i of s.derived.influences) {
      if (!builtInfluences[i]) {
        throw new CapacityError(`derived setting ${s.id} uses influence "${i}", not declared`);
      }
    }
  }

  detectDerivedCycle(builtSettings);

  const builtGroups = {};
  for (const [id, g] of Object.entries(groups)) {
    if (g?.template && !capability.templates[g.template]) {
      throw new CapacityError(`group ${id} names template "${g.template}", which is not declared`);
    }
    if (!Array.isArray(g?.settings) || !g.settings.length) {
      throw new CapacityError(`group ${id} needs a settings list`);
    }
    for (const sid of g.settings) {
      if (!builtSettings[sid]) {
        throw new CapacityError(`group ${id} references setting "${sid}", which is not declared`);
      }
    }
    for (const inf of g.influencedBy ?? []) {
      if (!builtInfluences[inf]) {
        throw new CapacityError(`group ${id} is influenced by "${inf}", which is not declared`);
      }
    }
    /* Point 3: a partial group is well-formed. Deliberately NOT validated
     * against the template's full property list. */
    builtGroups[id] = {
      id,
      description: g.description ?? "",
      template: g.template ?? null,
      settings: Object.freeze([...g.settings]),
      influencedBy: Object.freeze([...(g.influencedBy ?? [])]),
    };
  }

  const builtActions = {};
  for (const [id, a] of Object.entries(actions)) {
    if (!a?.body) throw new CapacityError(`action ${id} needs a body`);
    if (!a.trigger?.influence) {
      throw new CapacityError(
        `action ${id} needs a trigger — "Actions trigger as a result of ExternalInfluences"`,
      );
    }
    if (!builtInfluences[a.trigger.influence]) {
      throw new CapacityError(`action ${id} triggers on "${a.trigger.influence}", not declared`);
    }
    const reads = [...(a.reads ?? [])];
    const writes = [...(a.writes ?? [])];
    for (const sid of [...reads, ...writes]) {
      if (!builtSettings[sid]) {
        throw new CapacityError(`action ${id} declares access to "${sid}", which is not declared`);
      }
    }
    for (const sid of writes) {
      if (builtSettings[sid].derived) {
        throw new CapacityError(
          `action ${id} writes to derived setting "${sid}". A derived value is computed ` +
            `from its formula; writing it would make the profile inconsistent with itself`,
        );
      }
    }
    builtActions[id] = {
      id,
      description: a.description ?? "",
      trigger: Object.freeze({ influence: a.trigger.influence }),
      /* Setting Access, from Figure 3, made to mean something: the textual
       * equivalent of an ADFD's data flows to and from its data stores, and
       * what makes an Action inspectable without running it. */
      reads: Object.freeze(reads),
      writes: Object.freeze(writes),
      body: a.body,
    };
  }

  const model = {
    capability: capability.id,
    entity: Object.freeze({
      id: entity.id,
      kind: entity.kind,
      description: entity.description ?? "",
      /* Provenance of the profile itself. Recording it in the data, not only in
       * prose, is what stops a fixture being mistaken for a finding. */
      basis: entity.basis ?? "unspecified",
    }),
    settings: builtSettings,
    groups: builtGroups,
    actions: builtActions,
    influences: builtInfluences,
  };
  return deepFreeze(model);
}

function detectDerivedCycle(settings) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(Object.keys(settings).map((k) => [k, WHITE]));
  const stack = [];
  const visit = (id) => {
    colour.set(id, GREY);
    stack.push(id);
    for (const next of settings[id].derived?.reads ?? []) {
      if (colour.get(next) === GREY) {
        const from = stack.indexOf(next);
        throw new CapacityError(
          `derived setting cycle: ${[...stack.slice(from), next].join(" -> ")} ` +
            `(OOA96 §9.1 — loops are not permitted)`,
        );
      }
      if (colour.get(next) === WHITE) visit(next);
    }
    stack.pop();
    colour.set(id, BLACK);
  };
  for (const id of Object.keys(settings)) if (colour.get(id) === WHITE) visit(id);
}

/* ---------------------------------------------------------------------------
 * Resolution
 * ------------------------------------------------------------------------- */

/**
 * Every Setting's effective value under a given set of External Influences:
 * triggered Actions first, then derived (M) measurements in dependency order.
 *
 * The paper's argument for doing this at runtime rather than in an offline
 * tool: "only the on-line model is suitable for adaptive systems".
 */
/** Resolve a person's settings: fire actions, then compute derived (M) values.
 *
 *  `preferences` is optional and defaults to none, which is the ordinary case:
 *  a person states a view about the few things they care about and everything
 *  else falls to selection rules. Passing none is not "no opinions recorded
 *  yet", it is the resting state the rules exist to serve. */
export function resolve(capability, capacity, influences = {}, preferences = null) {
  for (const name of Object.keys(influences)) {
    const declared = capacity.influences[name];
    if (!declared) throw new CapacityError(`undeclared external influence: ${name}`);
    if (declared.values && !declared.values.includes(influences[name])) {
      throw new CapacityError(
        `influence ${name}="${influences[name]}" is not one of ${declared.values.join(", ")}`,
      );
    }
  }

  /* An influence not reported this time falls back to its declared default,
   * so a caller need not know every influence a profile depends on. */
  const effective = {};
  for (const [name, inf] of Object.entries(capacity.influences)) {
    if (inf.default !== null) effective[name] = inf.default;
  }
  Object.assign(effective, influences);

  const values = new Map();
  for (const s of Object.values(capacity.settings)) {
    values.set(s.id, { capability: s.capability, measurement: s.derived ? null : s.measurement });
  }

  const trace = [];
  const events = [];

  /* 1. Actions. An action whose trigger influence has not been *reported* does
   *    not fire — tested against what was reported rather than the defaults,
   *    because a default is a resting state and not an event. */
  for (const action of Object.values(capacity.actions)) {
    if (!(action.trigger.influence in influences)) continue;

    const before = new Map([...values].map(([k, v]) => [k, JSON.stringify(v)]));
    const store = new MapStore(Object.fromEntries([...values].map(([k, v]) => [k, { ...v }])));
    const result = run(action.body, { store, influences: effective, preferences });

    /* An action must not write outside its declared Setting Access. Checked
     * before applying, so a declared write cannot mask an undeclared one. The
     * same instinct as OOA96's static event checking (§6.2). */
    for (const key of store.keys()) {
      const now = JSON.stringify(store.read(key));
      if (now !== before.get(key) && !action.writes.includes(key)) {
        throw new CapacityError(
          `action ${action.id} wrote to "${key}", which is not in its declared writes ` +
            `(${action.writes.join(", ") || "none"})`,
        );
      }
    }

    for (const sid of action.writes) {
      const next = store.read(sid);
      if (next === undefined) continue;
      const property = capability.properties[capacity.settings[sid].property];
      values.set(sid, checkSetting(property, next, `action ${action.id} writing ${sid}`));
    }
    trace.push({ action: action.id, fired: true, steps: result.trace.length });
    events.push(...result.events);
  }

  /* 2. Derived (M) measurements, in dependency order. */
  for (const id of derivedOrder(capacity.settings)) {
    const s = capacity.settings[id];
    const store = new MapStore(Object.fromEntries([...values].map(([k, v]) => [k, { ...v }])));
    const result = run(s.derived.formula, { store, influences: effective, preferences });
    const property = capability.properties[s.property];
    values.set(
      id,
      checkSetting(
        property,
        { capability: "PARTIAL", measurement: result.value },
        `derived setting ${id}`,
      ),
    );
    trace.push({ derived: id, cite: s.derived.cite, measurement: result.value });
  }

  return Object.freeze({
    settings: Object.freeze(Object.fromEntries(values)),
    /* Convenience view: just the measurements, for formulae and assertions
     * that do not care about the capability half. */
    measurements: Object.freeze(
      Object.fromEntries([...values].map(([k, v]) => [k, v.measurement])),
    ),
    capabilities: Object.freeze(
      Object.fromEntries([...values].map(([k, v]) => [k, v.capability])),
    ),
    trace: Object.freeze(trace),
    events: Object.freeze(events),
  });
}

function derivedOrder(settings) {
  const out = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const r of settings[id].derived?.reads ?? []) visit(r);
    if (settings[id].derived) out.push(id);
  };
  for (const id of Object.keys(settings).sort()) visit(id);
  return out;
}

/** The effective settings of one Setting Group (context), resolved. */
export function groupValues(capability, capacity, groupId, influences = {}) {
  const group = capacity.groups[groupId];
  if (!group) throw new CapacityError(`no such setting group: ${groupId}`);
  const resolved = resolve(capability, capacity, influences);
  const out = {};
  for (const sid of group.settings) out[sid] = resolved.settings[sid];
  return Object.freeze({
    group: groupId,
    settings: Object.freeze(out),
    trace: resolved.trace,
    events: resolved.events,
  });
}

export { A, ActionError, CapabilityError };
