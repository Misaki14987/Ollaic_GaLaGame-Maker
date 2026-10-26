/**
 * Frontend IPC layer for character management.
 * Wraps Tauri invoke calls to the Rust characters module.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Character, CharacterRef } from './character-types';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** List all characters in the project. */
export async function listCharacters(projectPath: string): Promise<Character[]> {
  return invoke<Character[]>('list_characters', { projectPath });
}

/** Get a single character by id. */
export async function getCharacter(projectPath: string, id: string): Promise<Character> {
  return invoke<Character>('get_character', { projectPath, id });
}

/** Create a new character and persist. */
export async function createCharacter(
  projectPath: string,
  character: Character,
): Promise<Character> {
  return invoke<Character>('create_character', { projectPath, character });
}

/** Update an existing character. */
export async function updateCharacter(
  projectPath: string,
  character: Character,
): Promise<Character> {
  return invoke<Character>('update_character', { projectPath, character });
}

/** Delete a character by id. */
export async function deleteCharacter(projectPath: string, id: string): Promise<void> {
  return invoke<void>('delete_character', { projectPath, id });
}

/** Lightweight list of {id, name} pairs for dropdowns. */
export async function listCharacterNames(projectPath: string): Promise<CharacterRef[]> {
  return invoke<CharacterRef[]>('list_character_names', { projectPath });
}

/** Bulk-save the entire character list. */
export async function saveCharacters(
  projectPath: string,
  characters: Character[],
): Promise<void> {
  return invoke<void>('save_characters', { projectPath, characters });
}
