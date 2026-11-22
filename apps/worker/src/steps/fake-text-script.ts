/**
 * Fake Text conversation splitting — one place, two callers.
 *
 * `create-scenes` splits conversations into scenes and stores per-scene data.
 * `create-images` reads that data to render chat skins.
 * `create-vocal` uses the same data for per-character TTS.
 */

import type {
  FakeTextConversation,
  ChatCharacter,
  ChatMessage,
} from '@facelesspro/contracts';

export interface FakeTextSceneData {
  template: string;
  characters: readonly ChatCharacter[];
  messages: readonly ChatMessage[];
  groupName?: string;
  groupPhoto?: string;
  tinderMatch?: boolean;
}

/** Maximum characters per scene for auto-split (roughly 15-20s of speech). */
export const FAKE_TEXT_SCENE_CHAR_LIMIT = 800;

/**
 * Split conversations into scenes.
 *
 * Each scene gets a subset of messages. If `autoSplit` is true, long
 * conversations are split across multiple scenes at message boundaries.
 * Returns one entry per scene with the messages belonging to that scene.
 */
export function splitFakeTextConversations(
  conversations: readonly FakeTextConversation[],
  autoSplit: boolean,
): readonly FakeTextSceneData[] {
  const scenes: FakeTextSceneData[] = [];

  for (const conversation of conversations) {
    const { messages, ...rest } = conversation;

    if (!autoSplit || messages.length === 0) {
      // Single scene for the whole conversation
      scenes.push({ ...rest, messages });
      continue;
    }

    // Auto-split: pack messages into scenes up to the character limit
    let currentMessages: ChatMessage[] = [];
    let currentChars = 0;

    for (const message of messages) {
      const msgChars = message.text.length + 50; // +50 for speaker prefix overhead

      if (currentMessages.length > 0 && currentChars + msgChars > FAKE_TEXT_SCENE_CHAR_LIMIT) {
        // Commit current scene
        scenes.push({ ...rest, messages: currentMessages });
        currentMessages = [message];
        currentChars = msgChars;
      } else {
        currentMessages.push(message);
        currentChars += msgChars;
      }
    }

    // Final scene
    if (currentMessages.length > 0) {
      scenes.push({ ...rest, messages: currentMessages });
    }
  }

  // If somehow no scenes were created (empty conversations), create one empty scene per conversation
  if (scenes.length === 0) {
    for (const conversation of conversations) {
      const { messages, ...rest } = conversation;
      scenes.push({ ...rest, messages });
    }
  }

  return scenes;
}

/**
 * Build the narration script for a fake-text scene.
 * Uses "Speaker: message" format, same as the planner sees.
 */
export function buildFakeTextScript(sceneData: FakeTextSceneData): string {
  const characterNames = new Map<string, string>();
  for (const character of sceneData.characters) {
    characterNames.set(character.id, character.name);
  }

  const parts: string[] = [];
  for (const message of sceneData.messages) {
    const speaker = message.characterId
      ? characterNames.get(message.characterId) ?? 'Unknown'
      : 'Unknown';
    parts.push(`${speaker}: ${message.text}`);
  }
  return parts.join(' ');
}

/**
 * Build narration scripts for all fake-text scenes.
 */
export function buildFakeTextScripts(sceneDataList: readonly FakeTextSceneData[]): string[] {
  return sceneDataList.map(buildFakeTextScript);
}

/**
 * Get the voice pair ID for a character in a fake-text conversation.
 * Falls back to a default if not specified.
 */
export function getCharacterVoicePair(
  message: ChatMessage,
  characters: readonly ChatCharacter[],
  defaultPairId: string,
): string {
  if (!message.characterId) return defaultPairId;
  const character = characters.find((c) => c.id === message.characterId);
  return character?.voiceId ?? defaultPairId;
}

/**
 * Get all unique voice pairs needed for a conversation.
 */
export function getConversationVoicePairs(
  conversation: FakeTextConversation,
  defaultPairId: string,
): string[] {
  const pairs = new Set<string>();
  for (const message of conversation.messages) {
    pairs.add(getCharacterVoicePair(message, conversation.characters, defaultPairId));
  }
  return [...pairs];
}