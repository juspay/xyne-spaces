import type { AgentCreateFormState } from './types';
import { detectIntakeGaps, questionsForGaps, type IntakeGap } from './classifyCreateTurn';

function snippet(text: string, max = 180): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

export function replyForCreateTurn(
  text: string,
  form: AgentCreateFormState,
  canvasEmpty: boolean,
): string {
  const lower = text.trim().toLowerCase();

  if (/^(hi|hello|hey|yo|sup|howdy)[\s!.]*$/.test(lower)) {
    return canvasEmpty
      ? 'Hi. Ask anything here — the canvas on the right is the agent.'
      : `Hi. ${form.name.trim() ? `${form.name.trim()} is on the canvas` : 'The draft is on the canvas'}. Ask about it, or tell me what to change.`;
  }

  if (/^(thanks|thank you|thx|cheers)[\s!.]*$/.test(lower)) {
    return 'You’re welcome. Edit the canvas anytime, or tell me what to change.';
  }

  if (/^(ok|okay|cool|great|nice)[\s!.]*$/.test(lower)) {
    return canvasEmpty
      ? 'Whenever you’re ready, describe the agent or fill in the canvas on the right.'
      : 'Sounds good. Say what to change, or edit the canvas directly.';
  }

  if (/instruction/.test(lower) && /(what|put|write|include|should|explain|how)/.test(lower)) {
    return 'Instructions are the system prompt: how the agent should work, what it must never do, and the shape of its replies. The Instructions field on the canvas is the source of truth.';
  }

  if (/handle|slug|@/.test(lower) && /(why|how|what|pick|choose)/.test(lower)) {
    if (form.slug.trim()) {
      return `@${form.slug} comes from the name, lowercased with hyphens. You can type a different handle on the canvas.`;
    }
    return 'There’s no handle yet. Describe the agent and I’ll draft one, or type it on the canvas.';
  }

  if (/(what does|what can this|what is this agent|what will this)/.test(lower)) {
    if (form.description.trim()) {
      return snippet(form.description);
    }
    if (form.systemPrompt.trim()) {
      return snippet(form.systemPrompt, 240);
    }
    return 'Nothing on the canvas yet. Describe the job here, or fill in the right-hand spec.';
  }

  if (/\bmcp\b/.test(lower) && /(how|add|connect|what)/.test(lower)) {
    return 'Use the MCP row on the canvas to connect a server. If you name a specific server, I can try to attach it.';
  }

  if (/\bskill/.test(lower) && /(how|add|what)/.test(lower)) {
    return 'Open the Skills row on the canvas and Add or Browse. I can’t invent a skill id from chat yet.';
  }

  if (/explain|how do i|what can i/.test(lower)) {
    return 'Left is chat. Right is the agent: name, handle, description, instructions, then MCP, tools, skills, and knowledge. Anything I write, you can edit by hand.';
  }

  return canvasEmpty
    ? 'Ask about the canvas, or describe the agent and I’ll draft it on the right.'
    : 'Ask about this draft, or tell me exactly what to change on the canvas.';
}

export const CLARIFY_REPLY =
  'Should I draft this on the canvas, or did you want an explanation first?';

export const SKILLS_ROW_REPLY =
  'I can’t attach a skill by name yet — pick it from the Skills row on the canvas.';

export const SKIP_INTAKE_ACK = 'All good. Edit the canvas or Create Agent whenever you’re ready.';

export const INTAKE_SKIP_HINT = 'You can skip and type on the canvas instead.';

function intakeLead(seed: string): string {
  if (/standup/i.test(seed)) return 'A standup agent — a few specifics will make this better:';
  if (/scribe/i.test(seed)) return 'A scribe — before I draft the canvas:';
  return 'I can draft that. A few specifics will make a better agent:';
}

export function intakeQuestionsReply(seed: string, gaps?: IntakeGap[]): string {
  const missing = gaps ?? detectIntakeGaps(seed);
  const questions = questionsForGaps(missing);
  const lines = questions.map(question => `• ${question}`).join('\n');
  return `${intakeLead(seed)}\n\n${lines}\n\n${INTAKE_SKIP_HINT}`;
}

export function draftThenAskReply(gaps: IntakeGap[]): string {
  const questions = questionsForGaps(gaps);
  if (questions.length === 0) {
    return 'Filled the canvas. Edit anything, then Create Agent.';
  }
  return `Filled the canvas. Edit anything, then Create Agent.\n\nStill useful:\n${questions.map(question => `• ${question}`).join('\n')}\n\nIgnore these and keep editing if you want.`;
}
