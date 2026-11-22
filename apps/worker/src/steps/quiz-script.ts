/**
 * Quiz narration derivation — one place, three callers.
 *
 * `create-scenes` plans from this text, `create-vocal` synthesizes exactly the
 * same text (the step refuses to continue if the scenes do not reconstruct it),
 * and `render` uses the same parts to locate each question's first character in
 * the scene spans, which is how a question image is matched to a scene.
 *
 * Every item contributes one part; parts are joined with a single space. The
 * answer template is narration-only, so it never reaches captions or the frame
 * manifest.
 */

import type { QuizItem } from '@facelesspro/contracts';

/** Spoken when the caller omits `answerTemplate`: the answer, after the question. */
export const DEFAULT_QUIZ_ANSWER_TEMPLATE = '{{answer}}';

/** The spoken text for one item, without the joining space. */
export function quizNarrationPart(item: QuizItem, answerTemplate: string): string {
  if (item.type !== 'question') return item.text;
  const answer = item.answers[item.correctIndex ?? 0] ?? '';
  const spoken = answerTemplate.replace('{{answer}}', answer).trim();
  return spoken.length === 0 ? item.text : `${item.text} ${spoken}`;
}

/** One part per item, in request order. */
export function quizNarrationParts(
  items: readonly QuizItem[],
  answerTemplate: string = DEFAULT_QUIZ_ANSWER_TEMPLATE,
): string[] {
  return items.map((item) => quizNarrationPart(item, answerTemplate));
}

/** The full narration script: parts joined with one space, as the planner expects. */
export function buildQuizScript(
  items: readonly QuizItem[],
  answerTemplate: string = DEFAULT_QUIZ_ANSWER_TEMPLATE,
): string {
  return quizNarrationParts(items, answerTemplate).join(' ');
}
