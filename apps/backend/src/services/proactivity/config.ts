import type { JsonValue } from '@openfeature/server-sdk';
import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

/**
 * Every number and every question the proactivity policy uses. One Superposition key,
 * `agent_proactivity_config`, merged over these defaults section by section, so a
 * partial override (say `{ "gate": { "needs_an_answer": 0.7 } }`) keeps everything else.
 * Changing a threshold or rewording a question is a config change, not a deploy.
 *
 * Each XOR question is named for what it asks, and a threshold sits under the same
 * name: XOR's probability that the answer is yes is compared with it.
 */
const PROACTIVITY_CONFIG_KEY = 'agent_proactivity_config';

/** A yes/no question. `{m}` is replaced by the quoted message it asks about. */
export interface QuestionText {
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export interface ProactivityConfig {
  /** The kill switch, checked on every message and again right before anything posts. */
  enabled: boolean;
  /** Bumped by whoever edits the config; stored with every decision. */
  version: string;
  episode: {
    quietSeconds: number;
    maxResets: number;
    maxWaitSeconds: number;
    typingGraceSeconds: number;
    /** A reply in a conversation waits this long for the thread to go quiet. */
    replyQuietSeconds: number;
    replyMaxWaitSeconds: number;
    /** A question that tags people waits this long, so they get first go. */
    mentionQuietSeconds: number;
    mentionMaxWaitSeconds: number;
    /** A new top-level message joins the waiting burst only at this yes to `same_topic`. */
    sameTopic: number;
  };
  /** Is there something open for an agent? Asked of each of the asker's messages. */
  gate: {
    // A message goes on only with a yes to all three of these…
    needs_an_answer: number;
    info_not_a_task: number;
    anyone_could_answer: number;
    // …and a yes to any of these keeps it quiet.
    personal_matter: number;
    already_answered: number;
    someone_took_it: number;
    /** "anyone?": answers the question it repeats instead, if that one is still open. */
    just_a_nudge: number;
  };
  /**
   * The agent the choice between them ranks first answers, when its own fit is at least
   * `relevant`. Up to `maxAgents` in all draft: the others only above `secondAgent` and
   * with at least `closeChoice` of the first one's share of the choice.
   */
  route: { relevant: number; secondAgent: number; maxAgents: number; closeChoice: number };
  /** Is the draft still worth posting? Asked once the draft is back, against the conversation then. */
  beforePosting: {
    // A yes here holds the draft, unless it contradicts that answer with a source (posted
    // as a correction), adds to it (redrafted to only what is new, then posted), or says
    // the same (a 👍 instead).
    already_answered: number;
    contradicts: number;
    adds_to_answer: number;
    same_answer: number;
    // A yes here holds it.
    no_longer_open: number;
    // It posts only with a yes to this.
    draft_answers: number;
  };
  /** A reply in a thread the agent answered: answered only with a yes to the first two and a no to the third. */
  followUps: {
    /** Untagged follow-ups the agent answers per thread; a tag always works. */
    max: number;
    asks_agent_more: number;
    asks_for_info: number;
    sensitive: number;
  };
  limits: {
    /**
     * Only a safety net for runs that never come back. A draft that comes back late is
     * checked like any other: if the question is still open, it posts.
     */
    draftTimeoutSeconds: number;
    draftsInFlightPerAgent: number;
    xorTimeoutMs: number;
    /** Longer drafts are held: an unprompted reply is a few lines. */
    maxDraftChars: number;
    /** The overall XOR budget: episodes judged per workspace per minute. */
    episodesPerMinute: number;
  };
  /**
   * How much of the conversation one decision reads. Each item is text XOR reads and
   * often questions it answers, so these bound a request's size; long threads can
   * have dozens of earlier messages.
   */
  context: {
    /** The asker's newest messages in a burst. */
    askedMessages: number;
    /** For a reply in a thread: its newest earlier messages, plus always the thread's first. */
    threadBefore: number;
    /** Messages said after the question, newest kept. */
    afterMessages: number;
    /** Replies a draft is compared with before posting: its own thread's first. */
    comparedReplies: number;
  };
  /** How far back a bump like "anyone?" looks for the question it repeats. */
  bumpLookbackHours: number;
  questions: {
    gate: Record<keyof ProactivityConfig['gate'], QuestionText>;
    /** Does a new top-level message belong with the burst already waiting? */
    same_topic: QuestionText;
    route: QuestionText;
    best_agent: QuestionText;
    beforePosting: Record<
      Exclude<keyof ProactivityConfig['beforePosting'], 'same_answer' | 'contradicts'>,
      QuestionText
    >;
    same_answer: QuestionText;
    contradicts: QuestionText;
    followUp: Record<Exclude<keyof ProactivityConfig['followUps'], 'max'>, QuestionText>;
  };
}

const SENSITIVE_CRITERIA = {
  true: "Personal matters about a particular person that are theirs to share, not the team's: their pay, salary band or bonus; their health, sickness, leave or medical situation; their performance rating, review or feedback; their family or private life.",
  false:
    'Work topics that only sound personal: policies, processes, documents, schedules and systems that anyone may ask about, even when they use words like leave, pay or on-call.',
};

export const DEFAULT_PROACTIVITY_CONFIG: ProactivityConfig = {
  enabled: false,
  version: 'default-2',
  episode: {
    quietSeconds: 60,
    maxResets: 5,
    maxWaitSeconds: 180,
    typingGraceSeconds: 20,
    replyQuietSeconds: 600,
    replyMaxWaitSeconds: 1200,
    mentionQuietSeconds: 300,
    mentionMaxWaitSeconds: 600,
    sameTopic: 0.5,
  },
  gate: {
    needs_an_answer: 0.65,
    info_not_a_task: 0.8,
    anyone_could_answer: 0.85,
    personal_matter: 0.5,
    already_answered: 0.5,
    someone_took_it: 0.65,
    just_a_nudge: 0.75,
  },

  // More agents only on a near-certain fit: broad descriptions clear 0.8 for questions
  // that aren't theirs.
  route: { relevant: 0.4, secondAgent: 0.9, maxAgents: 3, closeChoice: 0.5 },
  beforePosting: {
    already_answered: 0.5,
    contradicts: 0.85,
    adds_to_answer: 0.6,
    same_answer: 0.5,
    no_longer_open: 0.5,
    draft_answers: 0.5,
  },
  followUps: { max: 3, asks_agent_more: 0.5, asks_for_info: 0.5, sensitive: 0.5 },
  limits: {
    draftTimeoutSeconds: 1800,
    draftsInFlightPerAgent: 3,
    xorTimeoutMs: 10_000,
    maxDraftChars: 800,
    episodesPerMinute: 120,
  },
  context: {
    askedMessages: 6,
    threadBefore: 20,
    afterMessages: 40,
    comparedReplies: 15,
  },
  bumpLookbackHours: 24,
  questions: {
    gate: {
      needs_an_answer: {
        instructions:
          '{m}\nIs the sender waiting for someone to answer them, or to look into a problem they report?',
        criteria: {
          true: 'They asked something they want answered: a fact, a how-to, where or whether something is, or why something happens. Or they report a specific failure someone could look into: what is broken, failing, slow or missing. It need not be phrased as a question.',
          false:
            'They are not waiting for an answer: they propose or plan what the team should do, share an opinion, a finding or an update, answer someone, wish for the product to work differently, vent about something without naming what to look at, make small talk, or paste ids, links or logs with no words saying what is wanted.',
        },
      },
      info_not_a_task: {
        instructions:
          '{m}\nIs this asking for information, or reporting a problem to look into, rather than asking someone to do a task?',
        criteria: {
          true: 'It wants a fact, an explanation, a status, where something is or who owns it, or whether or how something can be done or already exists. Or it reports something broken, failing, slow, missing or not happening that can be looked into, including by what goes wrong because of it, even when it asks for it to be fixed.',
          false:
            'It asks someone to do a task that is not looking into a problem: review, approve, merge or deploy a specific change, add someone, change a setting, decide, give an opinion, or build, add or change something in the product.',
        },
      },
      anyone_could_answer: {
        instructions:
          '{m}\nCould anyone who knows give this, rather than only the person it is about?',
        criteria: {
          true: 'Someone who knows, or can check docs, code, logs or earlier threads, could give it. A question about what happened, why something is failing, what exists or how to do something is for anyone who knows, even when it names or tags people or starts with "did we" or "do we". So is a report that something is not working, even if only the reporter has seen it.',
          false:
            'Only one particular person can give it: it asks them how their own work stands (whether they did, deployed, updated or finished something, or are still facing a problem), about their plans or availability, or about what they just said or meant.',
        },
      },
      personal_matter: {
        instructions:
          "{m}\nIs this message about someone's salary or compensation, their health or leave, their performance review, or their private life?",
        criteria: SENSITIVE_CRITERIA,
      },
      already_answered: {
        instructions:
          '{m}\nLooking only at the messages listed under "After that", has someone already given the specific thing this message asks for?',
        criteria: {
          true: 'A later message gives the answer, the link or the fact that was asked for',
          false:
            'Nobody has given it yet, or the replies only discuss it, ask back or say they will check',
        },
      },
      someone_took_it: {
        instructions:
          '{m}\nLooking at the messages after it, has someone other than the asker said they are on it or will get back about it?',
        criteria: {
          true: 'Someone other than the asker committed to it: they are looking into it, will check or reply, or say it is fixed or being fixed.',
          false:
            'Nobody committed to it: the later messages ask back, acknowledge, add another report of the same problem, or are from the asker.',
        },
      },
      just_a_nudge: {
        instructions:
          '{m}\nIs this message only a nudge about an earlier question, with nothing new in it?',
        criteria: {
          true: 'It does not say what it is about: it only asks again whether anyone has an answer or an update, like a bare nudge or reminder.',
          false:
            'It states the actual question or problem, even if it says "again" or repeats something asked before, or it adds anything new.',
        },
      },
    },
    same_topic: {
      instructions:
        'Is the new message about the same thing as the earlier messages, continuing the same question or problem?',
      criteria: {
        true: 'It adds to or continues the same question or problem: more detail, context, a correction, evidence, or the actual question after a greeting',
        false: 'A different question or topic, one that would need its own answer',
      },
    },
    route: {
      instructions:
        'An assistant described as:\n"""\n{agent}\n"""\nIs what {asker} asks or reports something this assistant is described as handling: a question it answers, or a problem it investigates or fixes?',
      criteria: {
        true: 'It asks the kind of question this assistant is described as answering, or reports the kind of problem it is described as investigating or fixing. People name the part they use, like an app, a screen or a feature, rather than the product, and the channel it was posted in often says which product it is about.',
        false:
          'Being about the same product is not enough: this assistant does not answer this kind of question or handle this kind of problem, the description says it is not for this, or it is about another product or area.',
      },
    },
    best_agent: {
      instructions:
        'Which of these assistants is best placed to answer what {asker} asks or reports, going by what each is described as answering, investigating or fixing?',
    },
    beforePosting: {
      already_answered: {
        instructions:
          'Looking only at the messages after the question in `conversation`, not at `draft`, has someone already given the specific thing that was asked for?',
      },
      no_longer_open: {
        instructions:
          'Looking only at the messages after the question in `conversation`, not at `draft`, has someone said they are on it, or has the person who asked said they no longer need it?',
      },
      draft_answers: {
        instructions:
          'Does `draft` actually answer the question or explain the problem, rather than say what it could not find or does not know?',
      },
      adds_to_answer: {
        instructions:
          'Looking at the replies after the question in `conversation`, does `draft` give useful information about the question that those replies do not already give?',
        criteria: {
          true: 'The draft has a fact, a step, a link or a cause the replies leave out',
          false: 'Everything useful in the draft is already in the replies, maybe in other words',
        },
      },
    },
    // Both replies quoted side by side. Asked through `draft` instead, XOR scored a
    // reply giving the very same link 0.08; quoted, 0.69-0.87, against 0.12 or less
    // for a wrong link, a vague pointer or "not sure".
    same_answer: {
      instructions:
        'A reply someone already posted:\n"""\n{reply}\n"""\nA reply an assistant drafted:\n"""\n{draft}\n"""\nDo both replies give the same answer to the question?',
      criteria: {
        true: 'Yes, the same answer, maybe in fewer words',
        false: 'No: a different answer, a vague pointer, or nothing specific',
      },
    },
    contradicts: {
      instructions: '{m}\nDoes `draft` contradict a fact stated in this message?',
    },
    followUp: {
      asks_agent_more: {
        instructions:
          'The assistant answered in this thread. Does `reply` ask the assistant for something more about its answer, or a follow-up question to it?',
      },
      asks_for_info: {
        instructions:
          'Does `reply` ask for information, rather than ask for an action or a change like editing, creating or sending something?',
      },
      sensitive: {
        instructions:
          "Is `reply` about someone's salary or compensation, their health or leave, their performance review, or their private life?",
        criteria: SENSITIVE_CRITERIA,
      },
    },
  },
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `override` over `base`, recursively, keeping only keys `base` has and values of the
 * same type, so a typo or a string where a number belongs can't switch anything off.
 * Exported for tests.
 */
export function mergeConfig<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!(key in base)) continue;
    const current = (base as Record<string, unknown>)[key];
    if (isPlainObject(current)) {
      merged[key] = mergeConfig(current, value);
    } else if (
      typeof value === typeof current &&
      (typeof value !== 'number' || Number.isFinite(value))
    ) {
      merged[key] = value;
    }
  }
  return merged as T;
}

/**
 * The live config for a workspace. Falls back to the defaults, which are off, when
 * Superposition isn't reachable: proactivity never runs on a config it couldn't read.
 * The client initialises itself on first read, in the API and the worker alike.
 */
export async function loadProactivityConfig(workspaceId: string): Promise<ProactivityConfig> {
  try {
    const remote = await superpositionClient.getObjectValue(
      PROACTIVITY_CONFIG_KEY,
      {} as JsonValue,
      {
        workspaceId,
      }
    );
    // Superposition hands back a JSON object as a string when it was stored as one.
    return mergeConfig(
      DEFAULT_PROACTIVITY_CONFIG,
      typeof remote === 'string' ? JSON.parse(remote) : remote
    );
  } catch (error) {
    logger.warn('[Proactivity] config read failed, staying off', { workspaceId, error });
    return DEFAULT_PROACTIVITY_CONFIG;
  }
}
