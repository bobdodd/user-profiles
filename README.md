# user-profiles

A service domain for **describing people to computers**: what somebody is able to do, and
what they would rather.

Re-used by applications rather than owned by one. The profile service and the Tetris
demonstrator each compose this domain with their own bridges and their own population;
neither knows the other exists.

## Two models, because they answer different questions

**Capability describes.** It is an attempt to describe one person, or generically the
typical capabilities of an identified group, and it has no authority beyond that attempt.
Every property is FULL, PARTIAL or NONE, with a measurement on the middle value and
nowhere else. Fifty-nine properties across five ontologies.

**Preference chooses.** Four categories at descending levels of abstraction — design
space, modality, perception, tooling — in one key space, taking one of two shapes: a
partial **order**, or a validated **value**.

**Capability does not bound preference.** Not a floor, not a ceiling, not a veto.
Validation refuses an invalid type and never an unwelcome choice. Somebody may want lower
contrast, or smaller text, or a channel a profile suggests will not serve them, and the
model does not argue.

## What is enforced

- A measurement may only qualify PARTIAL. Absence beneath a NONE is not zero, because
  zero asserts a measurement of something that is not there.
- Every property declares what a system does differently for knowing it. A property that
  decides nothing is a medical observation with a schema around it.
- Precedence is acquisition order. NONE propagates down it; FULL does not.
- Ordered scales must declare themselves ordered. Comparing values on a scale that has
  not is refused rather than inventing a rank.
- An inferred preference never overwrites a stated one, and provenance records which is
  which, so inferences can be redrawn when the choice they came from changes.

## Fred is like Jim except

Profiles are differences from a reference. A generic profile is a **constructor, not a
classifier**: the mechanism that makes a template usable is the same one that moves away
from it, so using it commits you to individualising it.

## Use

```js
import { defineCapability } from "user-profiles/capability";
import { resolve }          from "user-profiles/capacity";
import { statePreferences } from "user-profiles/preference";
import { userCapability }   from "user-profiles/vocabulary/capability";
```

## Dependencies

`action-language`, for derived settings and inference rules. The notation is architecture
rather than subject matter and lives in its own repository.

## Licence

Code is GPL-3.0-or-later. Documentation is CC BY-SA 4.0; see `docs/LICENSE`.
