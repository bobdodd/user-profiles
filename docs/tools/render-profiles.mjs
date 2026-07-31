/* Generate docs/user-profiles.md from the live models.
 *
 * The tables follow the presentation of Tables 1 to 4 in "User Capability in an
 * Adaptive World" (MSIADU'09), because that is the form the models were
 * published in and a reader who knows the paper should recognise the document.
 *
 * WHY GENERATED. A hand-written table drifts from the code within a week, and
 * then the document quietly becomes the wrong answer that everyone quotes. This
 * reads the actual Capability and Capacity Models and renders what is there, so
 * "the document says X" and "the model does X" cannot come apart. If a profile
 * changes, re-run it.
 *
 *     node docs/tools/render-profiles.mjs > docs/user-profiles.md
 */

import { userCapability } from "../../vocabulary/user-capability.js";
import { exemplars } from "../../vocabulary/profiles.js";
import { resolve } from "../../model/capacity.js";
import { assistantContribution, supersededSettings } from "../../model/group.js";
import { isOfInterest, decisionGroups } from "../../model/capability.js";

const out = [];
const w = (...lines) => out.push(...lines);

/* --- helpers -------------------------------------------------------------- */

const esc = (s) => String(s).replace(/\|/g, "\\|");

/** One line of prose from a description, for a table cell. The full text lives
 *  in the source; a table that reprints three sentences per row is unreadable. */
const brief = (text, max = 150) => {
  const first = String(text).replace(/\s+/g, " ").trim();
  if (first.length <= max) return esc(first);
  const cut = first.slice(0, max);
  const at = cut.lastIndexOf(". ");
  return esc((at > 60 ? cut.slice(0, at + 1) : cut.trimEnd() + "…"));
};

/** Render a measurement specification the way the paper's Values column does. */
function specOf(property) {
  const m = property.measurement;
  if (!m) return "—";
  switch (m.type) {
    case "boolean": return "TRUE / FALSE";
    case "discrete": return `${m.values.join(", ")}${m.multiple ? " (one or more)" : ""}`;
    case "numeric": return `${m.min}–${m.max} ${m.unit}`;
    case "numericRange": return `range in ${m.unit}`;
    case "text": return "text";
    case "composite":
      if (m.of) return `collection of ${specOf({ measurement: m.of })}, ${m.order}`;
      return m.parts.map((p) => `${p.name}: ${specOf({ measurement: p })}`).join(" + ");
    default: return m.type;
  }
}

/** One tuple — `{tag, listening, …}` or `{x, y, w, h}` — as readable text.
 *  A `tag` leads, because for knownLanguages it names what the rest describes. */
function tupleText(o) {
  const entries = Object.entries(o);
  const tag = entries.find(([k]) => k === "tag");
  const rest = entries.filter(([k]) => k !== "tag");
  const body = rest.map(([k, v]) => `${k} ${v}`).join(", ");
  return tag ? `**${tag[1]}** — ${body}` : body;
}

/** Render a measurement *value* as recorded in a profile. */
function valueOf(measurement) {
  if (measurement === null || measurement === undefined) return "—";
  if (Array.isArray(measurement)) {
    if (!measurement.length) return "—";
    const first = measurement[0];
    /* A collection of ranges: usableFrequencyRange, binauralHearing. */
    if (typeof first === "object" && first !== null && "from" in first) {
      return measurement.map((r) => `${r.from}–${r.to}`).join(", ");
    }
    /* A collection of tuples: knownLanguages. Rendered one per line so four
     * skills per language stay legible rather than becoming a wall of commas. */
    if (typeof first === "object" && first !== null) {
      return measurement.map(tupleText).join("; ");
    }
    /* A plain set: signLanguageSet, writeFontSet. */
    return measurement.join(", ");
  }
  if (typeof measurement === "object") {
    if ("from" in measurement) return `${measurement.from}–${measurement.to}`;
    return tupleText(measurement);
  }
  return String(measurement);
}

const unitOf = (property) => {
  const m = property.measurement;
  if (!m) return "";
  if (m.unit) return ` ${m.unit}`;
  return "";
};

const parentsOf = (name) => {
  const p = userCapability.properties[name].precedence;
  return p.length ? p.join(", ") : "None";
};

/* --- header --------------------------------------------------------------- */

w(
  "# User capability profiles",
  "",
  "Generated from the live models by `docs/tools/render-profiles.mjs`. Do not edit by",
  "hand: re-run the script instead. The tables follow the presentation of Tables 1 to 4",
  "in *User Capability in an Adaptive World* (Dodd, Green & Pearson, MSIADU'09,",
  "[doi:10.1145/1631097.1631110](https://doi.org/10.1145/1631097.1631110)).",
  "",
  "## What these profiles are, and what they are not",
  "",
  "They are **stand-ins**. They exist so the cradle has something to adapt to before",
  "there is anyone real to adapt to, and they are to be replaced or augmented with",
  "lived experience as and when it is available. Every profile records its basis in",
  "the data rather than only in prose, so a fixture cannot quietly become a finding.",
  "",
  "They are deliberately **not personas**. There is no name, age, occupation or",
  "narrative, because those invite a reader to generalise from a character to a",
  "population. What is recorded is capability and nothing else, which is the source",
  "paper's own argument: *\"It is what the user can do, not why she cannot.\"*",
  "",
  "## How to read a capability",
  "",
  "Every property is **FULL**, **PARTIAL** or **NONE**. A measurement appears against",
  "PARTIAL and against nothing else.",
  "",
  "| Value | Means | Measurement |",
  "|---|---|---|",
  "| `FULL` | The capability is unimpaired. | None — there is nothing left to qualify. |",
  "| `PARTIAL` | The capability exists but is limited. | Required, where the property declares one. |",
  "| `NONE` | The capability is absent. | None — there is nothing there to measure. |",
  "",
  "So a user who cannot perceive contrast has `contrastSensitivity: NONE`. Writing 0%",
  "would claim that a measurement was taken of something that is not there.",
  "",
  "### Why most properties are missing from most profiles",
  "",
  "The paper attaches a rule to the top of every table: *\"Remaining template",
  "properties only of interest for PARTIAL sight.\"* Read literally, and it is meant",
  "literally, that says a child property is worth asking about only when its parent is",
  "PARTIAL. A FULL parent leaves no impairment to describe; a NONE parent leaves",
  "nothing to describe either.",
  "",
  "Two consequences run through every table below:",
  "",
  "- **NONE propagates.** A capability cannot exist beneath one that does not. The",
  "  model refuses `colorLow: PARTIAL` under `sight: NONE`.",
  "- **FULL does not propagate.** It makes children *uninteresting*, not forbidden.",
  "  Someone with tunnel vision has PARTIAL sight and may have entirely FULL colour",
  "  perception, and a Braille reader has FULL language with a very specific",
  "  `hapticLanguageSet`. Recording either is extra detail, not a contradiction.",
  "",
  "This is why the reference profile below is seven lines and the blind exemplar is",
  "one line different from it.",
  "",
);

/* --- the capability model, by template ------------------------------------ */

w(
  "---",
  "",
  "## The Capability Model",
  "",
  "The schema: what *can* be known about a person. It holds no user data. The",
  "`Values` column shows the measurement that qualifies PARTIAL, or `—` where PARTIAL",
  "needs no further detail — `focus` is PARTIAL for blurred or double vision and that",
  "is the whole statement.",
  "",
);

for (const template of Object.values(userCapability.templates)) {
  w(`### Template: ${template.name}`, "", template.description, "");
  w("| Property | Values (PARTIAL measurement) | Parent | What it decides |",
    "|---|---|---|---|");
  const ordered = userCapability.acquisitionOrder.filter((n) => template.properties.includes(n));
  for (const name of ordered) {
    const p = userCapability.properties[name];
    const d = p.decides.contributesOnly
      ? `${esc(p.decides.what)} — *with ${p.decides.with.map((x) => `\`${x}\``).join(", ")}*`
      : esc(p.decides.what);
    w(`| \`${name}\` | ${specOf(p)} | ${parentsOf(name)} | ${d} |`);
  }
  w("");
}

w(
  "### What the model is for",
  "",
  "Every property must name a decision some renderer, input handler or content",
  "selector actually makes. A property that cannot name one is a medical observation",
  "with a schema around it, and does not belong in a model of *interaction*.",
  "",
  "**Most properties do not decide alone.** `contrastSensitivity` sets no palette by",
  "itself; it does so with the six colour and intensity bands. The table below groups",
  "properties by the decision they serve, so a system can ask *\"what do I need in",
  "order to set the palette\"* rather than inspecting properties one at a time and",
  "guessing which combine.",
  "",
  "| Decision | Properties needed |",
  "|---|---|",
  ...decisionGroups(userCapability).map(
    (g) => `| ${esc(g.decision)} | ${g.properties.map((x) => `\`${x}\``).join(", ")} |`),
  "",
  "### Subject ontologies",
  "",
  "*\"Subject ontologies are disjoint, so individual properties exist in exactly one",
  "ontology.\"* Precedence, by contrast, crosses them freely — `readFontText` has",
  "parents in both `visual` and `language`, mirroring Table 4's own `readSignText`",
  "with *\"sight + signLanguageSet\"*.",
  "",
  "| Ontology | Nesbitt design space | Properties |",
  "|---|---|---|",
);
for (const o of Object.values(userCapability.ontologies)) {
  w(`| ${o.name} | ${o.designSpace ? "yes" : "no"} | ${o.properties.length} |`);
}
w("");

/* --- one table per profile ------------------------------------------------ */

w("---", "", "## The profiles", "");

for (const [key, profile] of Object.entries(exemplars)) {
  const recorded = Object.values(profile.settings);
  const byProperty = new Map(recorded.map((s) => [s.property, s.capability]));
  const known = (n) => byProperty.get(n);

  w(`### ${profile.entity.id}`, "", `*${profile.entity.description}*`, "");
  w(`**Basis:** ${profile.entity.basis}  `);
  w(`**Entity kind:** ${profile.entity.kind} · **Settings recorded:** ${recorded.length}`, "");

  w("| Setting | Property | Capability | Measurement | Parent |", "|---|---|---|---|---|");
  const order = userCapability.acquisitionOrder;
  const sorted = [...recorded].sort(
    (a, b) => order.indexOf(a.property) - order.indexOf(b.property),
  );
  for (const s of sorted) {
    const p = userCapability.properties[s.property];
    const measurement = s.derived
      ? "*derived — see below*"
      : s.measurement === null ? "—" : `${valueOf(s.measurement)}${
          typeof s.measurement === "number" ? unitOf(p) : ""}`;
    const settingName = s.id === s.property ? "—" : `\`${s.id}\``;
    w(`| ${settingName} | \`${s.property}\` | **${s.capability}** | ${measurement} | ${parentsOf(s.property)} |`);
  }
  w("");

  /* What is deliberately absent, and why. This is the most instructive column
   * of the whole document: it is where the precedence hierarchy does its work. */
  const notRecorded = Object.keys(userCapability.properties).filter((n) => !byProperty.has(n));
  const forbidden = notRecorded.filter((n) =>
    userCapability.properties[n].precedence.some((p) => known(p) === "NONE"));
  const uninteresting = notRecorded.filter((n) => !forbidden.includes(n));

  w(`**Not recorded: ${notRecorded.length} of ${Object.keys(userCapability.properties).length} properties.**`, "");
  if (forbidden.length) {
    w(`- **Cannot exist** (${forbidden.length}), because a precedence parent is NONE: ` +
      forbidden.map((n) => `\`${n}\``).join(", ") + ".", "");
  }
  if (uninteresting.length) {
    w(`- **Not of interest** (${uninteresting.length}), because no precedence parent is ` +
      `PARTIAL: ` + uninteresting.slice(0, 12).map((n) => `\`${n}\``).join(", ") +
      (uninteresting.length > 12 ? `, and ${uninteresting.length - 12} more` : "") + ".", "");
  }

  /* A group Entity's whole value is the division of labour, so show it. A
   * merged profile that hid who supplies what would be less useful than either
   * member's on its own. */
  if (profile.entity.kind === "group") {
    w("#### Who supplies what", "");
    w(`Members: ${profile.entity.members.map((m) => `\`${m}\``).join(" + ")}. ` +
      `Primary: \`${profile.entity.primary}\` — whose game it is.`, "");
    const lent = assistantContribution(profile);
    if (lent.length) {
      w("**The assistant lends** (motor capability only — see below):", "");
      w("| Setting | Pair | Why |", "|---|---|---|");
      for (const id of lent) {
        w(`| \`${id}\` | **${profile.settings[id].capability}** | ${profile.provenance[id].reason} |`);
      }
      w("");
    }
    const gone = supersededSettings(profile);
    if (gone.length) {
      w("**Superseded** — true of the primary alone, and a renderer must not act on them",
        "for the pair, because the assistant supplies the capability they hang beneath:", "");
      w("| Setting | Superseded by |", "|---|---|");
      for (const g of gone) w(`| \`${g.setting}\` | \`${g.supersededBy}\` |`);
      w("");
    }
    w("**What a co-pilot cannot lend.** Motor capability delegates cleanly — the game",
      "cannot tell whose finger arrived. Perception does not, at least not in real time: a",
      "buddy describing a falling piece is always describing where it *was*. And",
      "comprehension must not, because a buddy who decides what to do is not assisting,",
      "they are playing.", "",
      "So co-piloting rescues this player from a real-time game and would do nothing",
      "whatever for `deafblind`.", "");
  }

  /* Derived settings, with the OOA96 §2.3 citation the model insists on. */
  const derived = recorded.filter((s) => s.derived);
  if (derived.length) {
    w("#### Functionally dependent settings", "");
    w("Marked **(M)** for mathematical dependence, per OOA96 §2.3: *\"given values of the",
      "attributes in X, the value of Y can be determined by a formula or algorithm\"*. The",
      "model requires each one to cite its formula.", "");
    w("| Setting (M) | Reads | External influences | Formula |", "|---|---|---|---|");
    for (const s of derived) {
      w(`| \`${s.id}\` | ${s.derived.reads.map((r) => `\`${r}\``).join(", ")} | ` +
        `${s.derived.influences.map((i) => `\`${i}\``).join(", ") || "—"} | ` +
        `${esc(s.derived.cite)} |`);
    }
    w("");

    /* Resolve under every combination of the influences it depends on, so the
     * document shows the adaptation happening rather than describing it. */
    const infl = [...new Set(derived.flatMap((s) => s.derived.influences))];
    if (infl.length === 1) {
      const name = infl[0];
      const values = profile.influences[name].values ?? [];
      w(`**Resolved against \`${name}\`:**`, "");
      w(`| \`${name}\` | ` + derived.map((s) => `\`${s.id}\``).join(" | ") + " |",
        "|---|" + derived.map(() => "---|").join(""));
      for (const v of values) {
        const r = resolve(userCapability, profile, { [name]: v });
        w(`| ${v} | ` +
          derived.map((s) => valueOf(r.settings[s.id].measurement)).join(" | ") + " |");
      }
      w("",
        "One profile, two answers, no duplicated context. Access for All would need two",
        "whole `<context>` blocks to say this, which is the duplication the paper's §3",
        "criticises.", "");
    }
  }

  /* Setting groups. */
  const groups = Object.values(profile.groups);
  if (groups.length) {
    w("#### Setting groups (contexts)", "");
    w("| Group | Template | Settings | Influenced by |", "|---|---|---|---|");
    for (const g of groups) {
      w(`| \`${g.id}\` | ${g.template ?? "—"} | ${g.settings.map((s) => `\`${s}\``).join(", ")} | ` +
        `${g.influencedBy.map((i) => `\`${i}\``).join(", ") || "—"} |`);
    }
    w("");
  }
}

/* --- comparison ----------------------------------------------------------- */

w("---", "", "## All profiles compared", "");
w("Only properties recorded in at least one profile appear. A blank cell means the",
  "property is not recorded for that profile — either because a precedence parent is",
  "NONE, or because no parent is PARTIAL and so the question does not arise.", "");

const names = Object.keys(exemplars);
const everyProperty = userCapability.acquisitionOrder.filter((n) =>
  names.some((k) => Object.values(exemplars[k].settings).some((s) => s.property === n)));

w("| Property | " + names.join(" | ") + " |",
  "|---|" + names.map(() => "---|").join(""));
for (const prop of everyProperty) {
  const cells = names.map((k) => {
    const settings = Object.values(exemplars[k].settings).filter((s) => s.property === prop);
    if (!settings.length) return "";
    return settings
      .map((s) => {
        if (s.derived) return "PARTIAL *(M)*";
        if (s.capability !== "PARTIAL") return s.capability;
        const p = userCapability.properties[prop];
        const v = valueOf(s.measurement);
        return v === "—" ? "PARTIAL" : `PARTIAL ${v}${typeof s.measurement === "number" ? unitOf(p) : ""}`;
      })
      /* Plain separator rather than <br>: raw HTML does not survive the docx
       * render, and a cell that reads "PARTIAL size 12<br>PARTIAL (M)" in Word
       * would be worse than one that reads it on a single line. */
      .join("; ");
  });
  w(`| \`${prop}\` | ` + cells.join(" | ") + " |");
}
w("");

w("---", "",
  "## What is still missing",
  "",
  "- **No sonic exemplar.** The demonstrator is audio-first, and the composite",
  "  frequency-range-with-gaps is implemented and tested — notched loss, usable below",
  "  2 kHz and above 6 kHz — but no profile uses it. A profile with high-frequency",
  "  loss would exercise the sonic ontology the way `hand-tremor` exercises the motor",
  "  one.",
  "- **No Preference Model.** Figure 4 of the paper is not built. Capability and",
  "  preference are deliberately separate models, and only the first two are here.",
  "- **The Adaptation Model is partial.** Profiles are differences from a reference,",
  "  which is the paper's §8 mechanism, but Event Triggers, Instance Sequences and",
  "  Sequence No (Figure 5) are not implemented, so profiles cannot yet be composed in",
  "  a declared order under a trigger.",
  "- **Lived experience.** These are stand-ins. Everything above is a hypothesis about",
  "  what would matter, held until someone can say otherwise.",
  "");

process.stdout.write(out.join("\n") + "\n");
