import { adminClient } from '@/lib/supabase.server';
import { getItem, nextDue, judge, grade, counts } from '@/lib/quiz/items';

/**
 * One quiz turn. Reads conversations.mode_state.currentItemId; if Noah just
 * answered it, grades and advances. Returns a toolResult block that tells the
 * brain what to ask next (never the answer) and how the last answer went.
 */
export async function quizTurn(
  userId: string,
  conversationId: string,
  userText: string,
  modeState: Record<string, unknown>,
): Promise<{ toolResult: string; newState: Record<string, unknown> }> {
  const currentId = typeof modeState.currentItemId === 'string' ? modeState.currentItemId : undefined;
  let feedback = '';

  if (currentId && userText.trim()) {
    const item = await getItem(userId, currentId);
    if (item) {
      const ok = await judge(item.answer, userText, item.kind);
      await grade(userId, currentId, ok);
      feedback = ok
        ? `Noah's answer to "${item.prompt}" was CORRECT. Acknowledge briefly (a word or two), then ask the next one.`
        : `Noah's answer to "${item.prompt}" was WRONG. The correct answer is: ${item.answer}. Give it to him plainly, no scolding, then ask the next one.`;
    }
  }

  const next = await nextDue(userId, currentId);
  const { total, due } = await counts(userId);

  if (!next) {
    await setState(conversationId, {});
    return {
      toolResult: `## Quiz\n${feedback}\nNothing left due to review right now (${total} items total). Tell Noah he's caught up and offer to add more or exit the quiz.`,
      newState: {},
    };
  }

  await setState(conversationId, { currentItemId: next.id });
  return {
    toolResult:
      `## Quiz — current item (do NOT reveal the answer)\n` +
      `${feedback ? feedback + '\n' : ''}` +
      `Ask Noah this now: **${next.prompt}**  (${next.lang}, ${next.kind}${next.notes ? `; note: ${next.notes}` : ''}).\n` +
      `Just pose it in your voice — one line. ${due} due, ${total} total.`,
    newState: { currentItemId: next.id },
  };
}

async function setState(conversationId: string, state: Record<string, unknown>) {
  await adminClient.from('conversations').update({ mode_state: state }).eq('id', conversationId);
}
