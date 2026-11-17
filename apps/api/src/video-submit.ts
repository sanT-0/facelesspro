/**
 * The create doors share one persistence dependency.
 *
 * A template's route owns validation and any template-specific checks; the
 * injected `submitVideo` only inserts the row and enqueues `create-scenes` in
 * one transaction. Keeping the input a discriminated union means the server
 * implementation is checked against both create bodies instead of drifting
 * into an `unknown` bag.
 */

import type {
  CreateAiVideoRequestParsed,
  CreateAiVideoV3RequestParsed,
  VideoRow,
} from '@facelesspro/contracts';

export type SubmitVideoInput =
  | {
      readonly workspaceId: string;
      readonly body: {
        readonly kind: 'ai-video-v3';
        readonly body: CreateAiVideoV3RequestParsed;
      };
    }
  | {
      readonly workspaceId: string;
      readonly body: {
        readonly kind: 'ai-video';
        readonly body: CreateAiVideoRequestParsed;
      };
    };

export type SubmitVideo = (input: SubmitVideoInput) => Promise<VideoRow>;
