/**
 * The import merge — pulled out of storage.ts so it is pure (no chrome.*) and
 * scripts/selftest.mjs can check the merge-by-id semantics headlessly.
 *
 * Items and collections are matched by id, and people by handle: the incoming
 * file wins on conflicts, the same rule WebHighlighter and Instagram Research
 * Saver use for their imports. That makes "import the same backup twice"
 * idempotent, and makes restoring an older backup predictable (it's the
 * imported file's data for any id it names — ids it doesn't name are left
 * alone). This is "merge, not overwrite" at the store level: nothing already
 * on the device is dropped, only ids present in the file are touched.
 */

import { Backup, Collection, PersonNote, SavedItem } from './types';

export interface LocalData {
  items: SavedItem[];
  collections: Collection[];
  people: PersonNote[];
}

export interface MergeStats {
  /** Valid entries found in the imported file. */
  items: number;
  /** Of those, how many were not already on this device. */
  newItems: number;
  collections: number;
  newCollections: number;
  people: number;
  newPeople: number;
}

export interface MergeResult extends LocalData {
  stats: MergeStats;
}

export function mergeBackup(local: LocalData, incoming: Partial<Backup>): MergeResult {
  const itemsById = new Map(local.items.map(i => [i.id, i]));
  const incomingItems = Array.isArray(incoming.items) ? incoming.items : [];
  let newItems = 0;
  let validItems = 0;
  for (const item of incomingItems) {
    if (!item?.id || !Array.isArray(item.posts) || !item.posts.length) continue;
    validItems++;
    if (!itemsById.has(item.id)) newItems++;
    itemsById.set(item.id, item);
  }

  const collectionsById = new Map(local.collections.map(c => [c.id, c]));
  const incomingCollections = Array.isArray(incoming.collections) ? incoming.collections : [];
  let newCollections = 0;
  let validCollections = 0;
  for (const collection of incomingCollections) {
    if (!collection?.id || !collection.name) continue;
    validCollections++;
    if (!collectionsById.has(collection.id)) newCollections++;
    collectionsById.set(collection.id, collection);
  }

  const peopleByHandle = new Map(local.people.map(p => [p.handle, p]));
  const incomingPeople = Array.isArray(incoming.people) ? incoming.people : [];
  let newPeople = 0;
  let validPeople = 0;
  for (const person of incomingPeople) {
    if (!person?.handle || !person.note?.trim()) continue;
    validPeople++;
    if (!peopleByHandle.has(person.handle)) newPeople++;
    peopleByHandle.set(person.handle, person);
  }

  return {
    items: [...itemsById.values()],
    collections: [...collectionsById.values()],
    people: [...peopleByHandle.values()],
    stats: {
      items: validItems,
      newItems,
      collections: validCollections,
      newCollections,
      people: validPeople,
      newPeople,
    },
  };
}
