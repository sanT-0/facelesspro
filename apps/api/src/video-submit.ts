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
  CreateCaptionVideoRequestParsed,
  CreateFakeTextVideoRequestParsed,
  CreateQuizVideoRequestParsed,
  CreateRobloxVideoRequestParsed,
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
    }
  | {
      readonly workspaceId: string;
      readonly body: {
        readonly kind: 'quiz';
        readonly body: CreateQuizVideoRequestParsed;
      };
    }
  | {
      readonly workspaceId: string;
      readonly body: {
        readonly kind: 'fake-text';
        readonly body: CreateFakeTextVideoRequestParsed;
      };
    }
  | {
      readonly workspaceId: string;
      readonly body: {
        readonly kind: 'roblox';
        readonly body: CreateRobloxVideoRequestParsed;
      };
    }
  | {
      readonly workspaceId: string;
      readonly body: {
        readonly kind: 'caption';
        readonly body: CreateCaptionVideoRequestParsed;
      };
    };

export type SubmitVideo = (input: SubmitVideoInput) => Promise<VideoRow>;
