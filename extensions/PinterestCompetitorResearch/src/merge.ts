/**
 * Pure import-merge logic, split out of storage.ts so scripts/selftest.mjs
 * can check it headlessly (no chrome.* mocking required). Same rule as
 * WebHighlighter's and InstagramResearchSaver's importBackup: matched by id,
 * and the incoming file wins on conflicts — importing the same backup twice
 * never duplicates a card.
 */

import { Backup, Collection, ImportResult, PinCapture } from './types';

export interface MergeResult {
  collections: Collection[];
  pins: PinCapture[];
  stats: ImportResult;
}

export function validateBackup(raw: unknown): Backup {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'pinterest-competitor-research' || !Array.isArray(backup.pins)) {
    throw new Error('That file is not a Pinterest Competitor Research backup.');
  }
  return backup as Backup;
}

/**
 * Merges a validated backup into the current library. Pins are matched by id
 * (the pin's numeric id) and collections by id. Returns the full merged
 * collections and pins lists — callers are expected to write them back in
 * one pass rather than diffing further.
 */
export function mergeImport(backup: Backup, existingPins: PinCapture[], existingCollections: Collection[]): MergeResult {
  const byCollectionId = new Map<string, Collection>(existingCollections.map(c => [c.id, c]));
  let collectionsAdded = 0;
  for (const incoming of backup.collections ?? []) {
    if (!incoming?.id || !incoming.name) continue;
    if (!byCollectionId.has(incoming.id)) collectionsAdded++;
    byCollectionId.set(incoming.id, incoming);
  }
  const collections = [...byCollectionId.values()];

  const byPinId = new Map<string, PinCapture>(existingPins.map(p => [p.id, p]));
  let pinsImported = 0;
  for (const incoming of backup.pins ?? []) {
    if (!incoming?.id || !incoming.pinUrl) continue;
    byPinId.set(incoming.id, incoming);
    pinsImported++;
  }
  const pins = [...byPinId.values()];

  return { collections, pins, stats: { pins: pinsImported, collections: collectionsAdded } };
}
