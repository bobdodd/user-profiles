/* Group Entities: two people playing as one.
 * ---------------------------------------------------------------------------
 * MODEL PROVENANCE (design/DEMOS.md §6a)
 *
 *   MODEL SPECIFIES that this exists. The Capacity Model's Entity "is either a
 *   user, or a group of users", and §8 describes building one: "an
 *   InstanceApplication can be defined to hold a group Entity; that Entity is
 *   created in the Capacity Model. The settings of the group Entity are created
 *   as functionally dependent upon user settings, with a resolution… defined in
 *   Actions expressing dependence."
 *
 *   OUR CHOICE, and a departure worth stating plainly: the paper's resolution is
 *   "highest common denominator" settings so that a group sharing one machine
 *   all have full access — a classroom, where if one student needs 18pt then
 *   everyone gets 18pt. That is a merge toward the MOST ACCOMMODATING value,
 *   and it is correct for shared access to a single interface.
 *
 *   Co-pilot play is not that. Two people operate one game between them, and
 *   capability is DIVIDED rather than shared: whatever either can do, the pair
 *   can do. The resolution is a union, not an accommodation.
 *
 *   PARTIAL IMPLEMENTATION, marked. The paper puts the resolution in Actions and
 *   the merge in an InstanceApplication with a declared sequence. Neither the
 *   Adaptation Model's Instance Sequences nor cross-profile Actions are built
 *   (issue #6), so this merges in plain code with the rule stated here. What it
 *   does NOT do is version the pair over time, which is what Instance Sequences
 *   are for.
 *
 * WHY THIS MATTERS FOR THE DEMONSTRATOR
 *
 * The alternative-access profiles produced a conclusion that a real-time
 * falling-block game is structurally closed to a single-switch scanning user.
 * That is true of one person playing alone, and it is how the technology frames
 * the problem — but it is not how severely disabled gamers actually play. When
 * bespoke controls cannot bridge a gap, people share controls with a gaming
 * buddy who covers the timing or the inputs they cannot manage. Xbox ships a
 * Copilot mode that makes two controllers act as one, for exactly this.
 *
 * So the finding was too pessimistic, and pessimistic in a specific way: it
 * assumed the unit of play is an individual. It usually is. It is not always.
 *
 * WHAT A CO-PILOT CAN AND CANNOT LEND
 *
 * This is the part that decides the whole design, and it is not symmetric.
 *
 *   MOTOR capability delegates cleanly. A buddy's hands are as good as anyone's
 *   for pressing a button on time. Timing, dexterity, switch count, reach — all
 *   of it can be lent, because the game cannot tell whose finger arrived.
 *
 *   PERCEPTUAL capability does NOT delegate, at least not in real time. A
 *   sighted friend describing a falling piece cannot keep up with it, and by the
 *   time they have, the moment has passed. In a turn-based game the same
 *   description is perfectly workable, which is a fact about the game rather
 *   than about the people.
 *
 *   LANGUAGE and comprehension must not delegate at all. A buddy who decides
 *   what to do is not assisting, they are playing, and the model should not
 *   quietly describe that as access.
 *
 * The consequence is sharp and worth stating before anyone builds on it: a
 * co-pilot lets the switch-scanning user play a real-time game, and does NOT let
 * the DeafBlind user play an audio-visual one. Co-piloting solves motor and
 * timing problems. It does not solve perceptual ones.
 */

import { CapabilityError, rankOf } from "./capability.js";
import { CapacityError, checkSetting } from "./capacity.js";

/** Ontologies whose capabilities one person can exercise on another's behalf.
 *
 *  `motor` only, and the omissions are deliberate. Perception cannot be lent in
 *  real time; language must not be lent at all. */
export const DELEGABLE_ONTOLOGIES = Object.freeze(["motor"]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Combine two profiles into a group Entity that plays as one.
 *
 * The primary is the person whose game it is. The assistant lends motor
 * capability and nothing else, so every non-motor setting comes from the primary
 * unchanged — including the ones the assistant could technically supply, because
 * a buddy who perceives the game for you is playing it for you.
 *
 * Every resolved setting records which member supplied it, so the pair's profile
 * can be read as an account of who does what rather than as a merged blur.
 *
 * @param {object} capability  the Capability Model both members are typed by
 * @param {object} primary     the player whose game it is
 * @param {object} assistant   the buddy lending motor capability
 * @param {object} spec        {id, description, basis}
 */
export function copilotPair(capability, primary, assistant, spec = {}) {
  if (!capability?.properties) {
    throw new CapacityError("copilotPair needs a capability model");
  }
  for (const [label, member] of [["primary", primary], ["assistant", assistant]]) {
    if (!member?.settings) throw new CapacityError(`copilotPair: ${label} is not a profile`);
    if (member.entity.kind !== "user") {
      throw new CapacityError(
        `copilotPair: ${label} is a ${member.entity.kind}, and a pair is made of users`,
      );
    }
  }
  if (!spec.id) throw new CapacityError("copilotPair needs an id");

  /* Settings are keyed by id, and two profiles may hold several settings for one
   * property. Index by property so the union is computed per capability. */
  const byProperty = (profile) => {
    const out = new Map();
    for (const s of Object.values(profile.settings)) {
      if (!out.has(s.property)) out.set(s.property, s);
    }
    return out;
  };
  const mine = byProperty(primary);
  const theirs = byProperty(assistant);

  const settings = {};
  const provenance = {};

  for (const [name, property] of Object.entries(capability.properties)) {
    const a = mine.get(name);
    const b = theirs.get(name);
    const delegable = DELEGABLE_ONTOLOGIES.includes(property.ontology);

    /* Non-delegable: the primary's own capability, untouched. If the primary has
     * no setting the pair has none either — the assistant cannot supply it. */
    if (!delegable) {
      if (a) {
        settings[a.id] = { ...a };
        provenance[a.id] = { from: "primary", reason: `${property.ontology} does not delegate` };
      }
      continue;
    }

    /* Delegable and only one of them has it recorded: use it. */
    if (a && !b) {
      settings[a.id] = { ...a };
      provenance[a.id] = { from: "primary", reason: "assistant has no setting recorded" };
      continue;
    }
    if (b && !a) {
      settings[b.id] = { ...b, id: b.id };
      provenance[b.id] = { from: "assistant", reason: "primary has no setting recorded" };
      continue;
    }
    if (!a && !b) continue;

    /* Both recorded: the pair can do whatever the more capable of them can do. */
    const better = rankOf(b.capability) > rankOf(a.capability) ? b : a;
    const from = better === b ? "assistant" : "primary";
    settings[better.id] = { ...better };
    provenance[better.id] = {
      from,
      reason:
        a.capability === b.capability
          ? `both ${a.capability}; kept the primary's`
          : `assistant ${b.capability} vs primary ${a.capability}`,
    };
    if (a.capability === b.capability) provenance[better.id].from = "primary";
  }

  /* Re-check every resolved setting against the Capability Model. A union can
   * produce a combination neither member had — a pair with the primary's senses
   * and the assistant's hands — and that combination must still be well formed. */
  for (const s of Object.values(settings)) {
    checkSetting(
      capability.properties[s.property],
      { capability: s.capability, measurement: s.measurement },
      `pair ${spec.id} setting ${s.id}`,
    );
  }

  /* And the NONE-propagates rule still holds for the pair, because a lent
   * capability cannot sit beneath one the pair does not have. */
  const valueOf = (name) => {
    const found = Object.values(settings).find((s) => s.property === name);
    return found?.capability;
  };
  for (const s of Object.values(settings)) {
    for (const parent of capability.properties[s.property].precedence) {
      if (valueOf(parent) === "NONE" && s.capability !== "NONE") {
        throw new CapacityError(
          `pair ${spec.id}: ${s.id} is ${s.capability} but its parent ${parent} is NONE. ` +
            `A co-pilot cannot lend a capability that sits beneath one the pair lacks`,
        );
      }
    }
  }

  /* SUPERSEDED SETTINGS.
   *
   * When the assistant supplies a parent capability, the primary's settings
   * beneath it stop describing the pair. The switch user needs a slow scan; the
   * pair does not scan at all, because the assistant is using a keyboard. Left
   * unmarked, `activationTiming: needs a slow scan` would survive into the pair
   * and a renderer would obediently slow everything down for nobody.
   *
   * They are marked rather than deleted, because the fact is still true of the
   * primary and worth reading — "he needs a slow scan, and with a buddy he does
   * not have to" is more informative than silence. Marked and kept follows the
   * same reasoning as C7: a FULL parent makes a child uninteresting, never
   * forbidden. */
  for (const s of Object.values(settings)) {
    const parents = capability.properties[s.property].precedence;
    const lentParent = parents.find(
      (p) => Object.values(settings).some(
        (t) => t.property === p && provenance[t.id]?.from === "assistant",
      ),
    );
    if (lentParent && provenance[s.id]?.from === "primary") {
      provenance[s.id].supersededBy = lentParent;
      provenance[s.id].reason +=
        `; superseded — the assistant supplies ${lentParent}, so this describes the ` +
        `primary alone and not the pair`;
    }
  }

  return deepFreeze({
    capability: capability.id,
    entity: {
      id: spec.id,
      kind: "group",
      description: spec.description ?? "",
      basis: spec.basis ?? "exemplar",
      members: Object.freeze([primary.entity.id, assistant.entity.id]),
      primary: primary.entity.id,
    },
    settings,
    /* Who supplies what. The point of the pair is the division of labour, and a
     * merged profile that hides it would be less useful than either member's. */
    provenance: provenance,
    groups: {},
    actions: {},
    influences: primary.influences,
  });
}

/** What the assistant is actually contributing: the settings the pair holds
 *  because of them. Reads as a job description. */
export function assistantContribution(pair) {
  return Object.entries(pair.provenance)
    .filter(([, p]) => p.from === "assistant")
    .map(([id]) => id);
}

/** Settings that describe the primary alone and no longer the pair, because the
 *  assistant supplies the capability they hang beneath. A renderer must not act
 *  on these. */
export function supersededSettings(pair) {
  return Object.entries(pair.provenance)
    .filter(([, p]) => p.supersededBy)
    .map(([id, p]) => ({ setting: id, supersededBy: p.supersededBy }));
}

export { CapabilityError };
