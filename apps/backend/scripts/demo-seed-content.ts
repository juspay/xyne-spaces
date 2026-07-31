/**
 * Conversation content for `demo-seed.ts`.
 *
 * Kept separate from the seeding logic so the dialogue can be edited without
 * touching any Prisma code. Every line is written the way people actually talk —
 * teammates working out what a feature is good for, not a product tour.
 *
 * Each top-level line becomes its own conversation, which is one row in the
 * channel feed. A line carrying `to` is a reply and joins the thread of the line
 * it points at.
 */

export type Line = {
  /** Index into the demo user list — who is speaking. */
  from: number;
  text: string;
  /** Index of an earlier line in the same block; makes this a thread reply. */
  to?: number;
  /** Emoji reaction from another member. */
  react?: string;
};

export type Conversation = { lines: Line[] };

/** A short discussion that lives on the ticket's own conversation. */
export type TicketThread = Array<{ from: number; text: string }>;

export type ChannelSpec = {
  slug: string;
  purpose: string;
  /** Indices into the demo user list. First one is the channel admin. */
  members: number[];
  conversations: Conversation[];
};

/** Realistic teammates. Index 0 is the workspace admin / logged-in user. */
export const DEMO_USERS = [
  { first: 'Priya', last: 'Menon', title: 'Engineering Manager' },
  { first: 'Arjun', last: 'Rao', title: 'Backend Engineer' },
  { first: 'Sara', last: 'Iyer', title: 'Product Designer' },
  { first: 'Daniel', last: 'Okafor', title: 'Product Manager' },
  { first: 'Mei', last: 'Tanaka', title: 'Support Lead' },
  { first: 'Tom', last: 'Alvarez', title: 'Frontend Engineer' },
];

export const CHANNELS: ChannelSpec[] = [
  {
    slug: 'general',
    purpose: 'Everything and anything — the whole team is here.',
    members: [0, 1, 2, 3, 4, 5],
    conversations: [
      {
        lines: [
          { from: 0, text: "Morning everyone 👋 We're fully on Spaces from this week — the old tool is read-only now. Shout if anything is missing and I'll sort it out.", react: '🎉' },
          { from: 1, text: 'Took me two days to stop opening the old one out of habit, honestly.', to: 0 },
          { from: 3, text: "What made it stick for me was not having to copy a link from one place to explain something in another. The ticket and the conversation about the ticket are the same thing now.", to: 0 },
          { from: 5, text: 'Agreed. I have not pasted a "context for the above" message all week.', to: 0 },

          { from: 2, text: 'Can someone give me the short version of what lives where? I keep guessing.' },
          { from: 0, text: "Channels for anything the team should see, DMs for one-on-one, and a thread when a single message turns into its own discussion. That's genuinely it — the rest you pick up as you go.", to: 4 },
          { from: 2, text: 'And threads keep it out of the main feed? My channels get noisy fast.', to: 4 },
          { from: 0, text: "Right. Reply in a thread and the channel stays readable — people who care follow the thread, everyone else doesn't see twenty messages about one line.", to: 4, react: '👍' },
          { from: 4, text: 'The unread badge only counts the channel, not every thread, which is the part I appreciate.', to: 4 },

          { from: 5, text: 'The thing I did not expect to like is Ask AI. I asked what we decided about the onboarding flow and it pulled the actual conversation from three weeks ago plus the ticket that came out of it.' },
          { from: 4, text: "Wait, it searches across everything? Not just the channel I'm in?", to: 9 },
          { from: 5, text: 'Everything you already have access to. It is not going to surface things you could not open yourself.', to: 9 },
          { from: 4, text: "That's what I wanted to be sure of before asking it anything about customer issues.", to: 9 },
          { from: 0, text: 'Permissions are the same as everywhere else — it cannot widen your access.', to: 9 },

          { from: 3, text: "Has anyone used Claw for something real? I've been ignoring the agents tab." },
          { from: 1, text: 'I have it summarise the overnight failures each morning and drop them in #engineering. Took ten minutes to set up and I stopped starting my day in a log viewer.', to: 14 },
          { from: 3, text: 'Okay, that is a better answer than I expected.', to: 14 },
          { from: 1, text: 'The trick is one narrow job. When I asked it to "look after the pipeline" it did nothing useful.', to: 14, react: '😄' },
          { from: 5, text: 'Same lesson here. Specific prompt, specific output, otherwise it waffles.', to: 14 },

          { from: 2, text: "I've moved the flow diagrams to canvases instead of the design tool — mostly because people actually comment on them here. Nobody ever opened the links I used to paste.", react: '💯' },
          { from: 4, text: 'That is very real. A link to a doc is where feedback goes to die.', to: 19 },
          { from: 2, text: "You can drop a canvas straight into a ticket too, so the mock and the work item aren't two separate places.", to: 19 },

          { from: 0, text: "Reminder that calls are in here too — no separate app. Start one from a channel and whoever's around can join." },
          { from: 5, text: 'Does the recording stick around afterwards? I missed Tuesday.', to: 22 },
          { from: 0, text: 'Recording plus transcript. Which also means Ask AI can answer from what was said in the call, not just what someone typed up after.', to: 22 },
          { from: 5, text: "That's how I found the pricing decision. I never read a summary, I just asked.", to: 22, react: '🙌' },

          { from: 4, text: 'On my side the desk has been the big one. Customer emails land here, we reply from here, and turning one into a ticket is a click instead of a copy-paste ritual.' },
          { from: 3, text: 'Does the customer see any of the internal back-and-forth?', to: 26 },
          { from: 4, text: 'No — internal notes stay internal, only the reply goes out. I checked that carefully before moving support over.', to: 26 },

          { from: 0, text: "If you find yourself doing the same three clicks every day, look at automations before you accept it as your life. Ours moves anything untouched for a week back to triage." },
          { from: 1, text: 'Ours pings the channel when a ticket has been in review for two days. Petty but it works.', to: 29 },
          { from: 3, text: 'I want one that nags me specifically. Asking for a friend.', to: 29, react: '😂' },

          { from: 3, text: "Built a dashboard for the weekly review — open tickets by stage, what shipped, what's stuck. It replaced the spreadsheet I updated by hand every Thursday night.", react: '🙌' },
          { from: 0, text: 'That spreadsheet had a good run.', to: 32 },
          { from: 2, text: 'Rest in peace 🪦', to: 32 },
        ],
      },
      {
        lines: [
          { from: 4, text: "Small thing — you can DM yourself. I've started using it as a scratchpad for links I need later." },
          { from: 5, text: 'I did not know that and I am slightly annoyed at how useful it is.', to: 0 },
          { from: 2, text: 'This is the note-to-self app I kept meaning to install.', to: 0 },

          { from: 1, text: 'Pro tip: paste a ticket link into a message and it expands into a card with the stage and assignee. Saves opening it to see if it moved.' },
          { from: 3, text: 'Works for canvases and calls too, which I only found by accident.', to: 3 },

          { from: 0, text: 'Presence is worth turning on if you have not — it shows who is actually around before you start a call.' },
          { from: 5, text: 'Or before you send the "quick question" that is never quick.', to: 5, react: '😄' },
        ],
      },
    ],
  },

  {
    slug: 'product',
    purpose: 'Roadmap, specs, and what we ship next.',
    members: [3, 0, 2, 5],
    conversations: [
      {
        lines: [
          { from: 3, text: 'Draft spec for the new onboarding is up as a canvas. Comment directly on it rather than replying here, so feedback stays next to the thing it is about.' },
          { from: 2, text: 'Left notes on the third screen — I think we ask for too much before showing any value.', to: 0 },
          { from: 3, text: 'Agreed, and support hears the same thing. Making it a ticket so it does not get lost in this thread.', to: 0 },
          { from: 0, text: 'Link the ticket back here when you do, so the discussion and the work item stay connected.', to: 0 },

          { from: 5, text: 'Can we get a dashboard on drop-off by step? Guessing which screen loses people is not going well.' },
          { from: 3, text: 'Building it now. It updates on its own, so nobody has to refresh a spreadsheet before the review.', to: 4 },
          { from: 0, text: 'Put it in the channel when it is ready and I will pin it.', to: 4, react: '👍' },

          { from: 3, text: 'Question for the room: do we keep the roadmap as a board or as a canvas?' },
          { from: 0, text: 'Board. Stages give you the "what is actually moving" view, and the ETAs feed the dashboard.', to: 7 },
          { from: 2, text: 'Canvas for the shape of the quarter, board for the work. They are answering different questions.', to: 7 },
          { from: 3, text: 'Both it is. Canvas for the narrative, board for the tickets.', to: 7 },

          { from: 0, text: 'Reminder that stage ETAs drive the reminders — if a stage has no ETA, nothing nags anyone and things sit.' },
          { from: 3, text: 'That explains why "In Review" never chased us. Fixing it now.', to: 11 },
        ],
      },
    ],
  },

  {
    slug: 'engineering',
    purpose: 'Builds, incidents, and code review.',
    members: [1, 0, 5],
    conversations: [
      {
        lines: [
          { from: 1, text: 'Deploy is out. Two flaky tests in the payment suite, ticket already open.' },
          { from: 5, text: 'Is that the same flake as last week or a new one?', to: 0 },
          { from: 1, text: 'Same one. I linked the two tickets so we stop investigating it twice.', to: 0 },
          { from: 0, text: 'Linking is underrated. Half our duplicate work was two people not knowing about each other.', to: 0 },

          { from: 0, text: 'How did the on-call handover go now that everything is in one place?' },
          { from: 1, text: "Much better. The incident channel has the alert, the call recording, and the fix in one line of history. I didn't have to reconstruct anything.", to: 4 },
          { from: 5, text: 'The transcript saved me — I joined forty minutes late and caught up by reading instead of making everyone repeat themselves.', to: 4, react: '🔥' },

          { from: 5, text: 'Search question: is there a way to find messages only in a date range? I know the answer exists somewhere in March.' },
          { from: 1, text: 'Yes — filter by date and by channel in the same query. It is the only reason I ever find anything.', to: 7 },
          { from: 5, text: 'Found it. Also works with from: a person, which is what I actually needed.', to: 7 },

          { from: 1, text: 'Set up an agent to open a ticket automatically when the error rate crosses the threshold. It fills in the stage and assigns to on-call.' },
          { from: 0, text: 'Does it dedupe, or do we get twelve tickets for one incident?', to: 10 },
          { from: 1, text: 'Dedupes on the alert key. First one opens a ticket, the rest comment on it.', to: 10, react: '👏' },
          { from: 5, text: 'That is the version of this I have wanted for years.', to: 10 },

          { from: 5, text: 'Anyone else using the code-review agent on PRs, or is it just me shouting into the void?' },
          { from: 1, text: 'Using it. It is good at the boring pass — unused imports, missing error handling. Still need a human for whether the idea is right.', to: 14 },
        ],
      },
    ],
  },

  {
    slug: 'design',
    purpose: 'Design reviews and the component library.',
    members: [2, 3, 5],
    conversations: [
      {
        lines: [
          { from: 2, text: 'New empty states are on the canvas. Recorded a two-minute walkthrough instead of writing it all out — it is in the thread.' },
          { from: 5, text: 'Watched it, much clearer than a doc. One question about the loading state.', to: 0 },
          { from: 2, text: 'Answered inline on the canvas so the question sits next to the frame it is about.', to: 0 },
          { from: 3, text: 'This is the first design review I have not had to schedule a meeting for.', to: 0, react: '🙌' },

          { from: 2, text: 'Component library canvas is updated — spacing scale and the new button states.' },
          { from: 5, text: 'Can I link a component straight into a ticket so the build item points at the source of truth?', to: 4 },
          { from: 2, text: 'Yes, and it stays live — if I change the frame, the link still points at the current version.', to: 4 },

          { from: 3, text: 'Mentioning someone on a canvas notifies them, by the way. I did not know and left three comments nobody saw for a week.' },
          { from: 2, text: 'The comments were good. The silence was not personal.', to: 7, react: '😄' },
        ],
      },
    ],
  },

  {
    slug: 'announcements',
    purpose: 'Company-wide updates. Low traffic, high signal.',
    members: [0, 1, 2, 3, 4, 5],
    conversations: [
      {
        lines: [
          { from: 0, text: 'Search now covers call transcripts and canvases, not just messages and tickets. If you looked for something last month and came up empty, try again.', react: '🎉' },
          { from: 5, text: 'Just found a decision from a call I was not even on. This is great.', to: 0 },
          { from: 4, text: 'Same. Two support answers I had rewritten from scratch were already sitting in a transcript.', to: 0 },

          { from: 0, text: 'Weekly review moves to Thursday. The dashboard is pinned in #product — worth a look before the meeting rather than during it.' },
          { from: 3, text: 'It updates itself, so whatever you see Thursday morning is current.', to: 3 },

          { from: 0, text: 'Reminder: anyone can start a call from any channel. You do not need a scheduled meeting to talk to someone for four minutes.' },
          { from: 2, text: 'This has genuinely halved the number of things sitting in my "reply properly later" pile.', to: 5 },
        ],
      },
    ],
  },

  {
    slug: 'ai-help',
    purpose: 'Getting more out of Ask AI, agents, and automations.',
    members: [1, 0, 3, 4, 5],
    conversations: [
      {
        lines: [
          { from: 3, text: 'What is the actual difference between Ask AI and an agent? I use one and ignore the other.' },
          { from: 1, text: 'Ask AI answers questions about what is already in the workspace. An agent goes and does something on a trigger or a schedule.', to: 0 },
          { from: 5, text: 'Ask AI is "what happened", agents are "do this when that happens".', to: 0, react: '💡' },
          { from: 3, text: 'That framing finally makes it click, thank you.', to: 0 },

          { from: 4, text: 'Anyone got a prompt that reliably summarises a long ticket thread? Mine gives me a wall of text back.' },
          { from: 1, text: 'Ask for a specific shape — "three bullets: what broke, what we tried, what is next". Open-ended asks give open-ended answers.', to: 4 },
          { from: 4, text: 'Works much better. The shape was the missing part.', to: 4, react: '👍' },

          { from: 0, text: 'If an agent does something you did not expect, its run history shows every step and tool call. Worth reading before assuming it is broken.' },
          { from: 1, text: 'Half my "agent is broken" moments were the agent doing exactly what I asked.', to: 7, react: '😅' },

          { from: 5, text: 'Automation I set up this week: when a ticket moves to Done, post the summary in the channel where it was raised. Closes the loop without anyone remembering to.' },
          { from: 4, text: 'Stealing this for support.', to: 9 },
          { from: 3, text: 'Stealing it for product too. The "whatever happened to that" question disappears.', to: 9 },
        ],
      },
    ],
  },

  {
    slug: 'random',
    purpose: 'Non-work chatter. Pets, food, and terrible puns.',
    members: [0, 1, 2, 3, 4, 5],
    conversations: [
      {
        lines: [
          { from: 2, text: 'Someone left an excellent cake in the kitchen and I need to know who to thank.' },
          { from: 5, text: 'Was it the lemon one? Because that was me and I accept praise in emoji form.', to: 0, react: '🍰' },
          { from: 4, text: 'Confirmed excellent. Ten out of ten.', to: 0 },

          { from: 1, text: 'My cat has learned to sit on the laptop precisely during calls. Considering a co-author credit.' },
          { from: 3, text: 'Post the picture or it did not happen.', to: 3 },
          { from: 1, text: 'Attached to the thread. She is not sorry.', to: 3, react: '😹' },

          { from: 0, text: 'Friday lunch — the usual place, 1pm. React if you are in so I can book the right table.', react: '🙌' },
          { from: 2, text: 'In. Also the reaction-as-a-headcount thing is the most useful feature nobody lists on a feature page.', to: 6 },
        ],
      },
    ],
  },
];

/** Tickets seeded onto the demo board, referencing the conversations above. */
export const TICKETS = [
  {
    title: 'Onboarding asks for too much before showing value',
    description:
      'Raised in #product from the onboarding spec review, and support is hearing the same thing. Step 3 collects company details before the user has seen anything work. Proposal: defer to after first successful action.',
    status: 'TODO' as const,
    priority: 'HIGH' as const,
    assignee: 3,
    reporter: 2,
    thread: [
      { from: 2, text: 'Pulled the numbers — 38% drop off on step 3, which is where we ask for company size and team structure.' },
      { from: 3, text: 'That matches what support hears. Nobody knows their \'team structure\' before they\'ve seen the product do anything.' },
      { from: 0, text: 'Do we need any of it up front, or is this a \'we asked because we could\' situation?' },
      { from: 3, text: 'Honestly the second one. Proposal: collect nothing until after the first successful action, then ask in context.' },
      { from: 2, text: 'I\'ll mock the deferred version on the canvas so we can compare side by side.' },
    ],
  },
  {
    title: 'Flaky tests in the payment suite',
    description:
      'Two tests in the payment suite fail intermittently on CI. Same flake as last week rather than a new one — see the linked ticket. Blocking nothing right now but it is eroding trust in the pipeline.',
    status: 'STARTED' as const,
    priority: 'MEDIUM' as const,
    assignee: 1,
    reporter: 1,
    thread: [
      { from: 1, text: 'Same two tests as last week. They pass locally every time and fail on CI roughly one run in four.' },
      { from: 5, text: 'Timing or ordering?' },
      { from: 1, text: 'Ordering. They share a fixture and whichever runs second gets a stale balance.' },
      { from: 5, text: 'So it\'s not really flaky, it\'s just wrong and we got lucky most of the time.' },
      { from: 1, text: 'Correct, and I\'d rather fix the fixture than add a retry and pretend.' },
    ],
  },
  {
    title: 'CSV import fails on files exported from Excel',
    description:
      'Three customer reports merged into one. Files exported from Excel with a BOM header fail to parse. Customer file attached from the support desk conversation.',
    status: 'TODO' as const,
    priority: 'CRITICAL' as const,
    assignee: 1,
    reporter: 4,
    thread: [
      { from: 4, text: 'Three customers, same symptom — export from Excel, upload, \'unrecognised column\' on the first header.' },
      { from: 1, text: 'Byte-order mark. Excel writes one, our parser reads it as part of the first column name.' },
      { from: 4, text: 'That would explain why re-saving through Sheets works and nobody could tell me why.' },
      { from: 1, text: 'Strip the BOM on read. Two-line fix, but worth a test so it doesn\'t come back.' },
    ],
  },
  {
    title: 'Drop-off dashboard by onboarding step',
    description:
      'Product needs per-step drop-off to stop guessing which screen loses people. Replaces the manually updated spreadsheet used in the weekly review.',
    status: 'STARTED' as const,
    priority: 'MEDIUM' as const,
    assignee: 3,
    reporter: 5,
    thread: [
      { from: 5, text: 'Rough version is up. Funnel by step, filterable by signup week.' },
      { from: 3, text: 'Can it split by plan? I suspect self-serve and sales-led behave differently.' },
      { from: 5, text: 'Added. They do behave differently — self-serve loses people at step 3, sales-led barely notices it.' },
      { from: 3, text: 'That\'s a useful finding on its own.' },
    ],
  },
  {
    title: 'Empty states for search and inbox',
    description:
      'New empty states walked through on the design canvas. Needs the loading-state question resolved before build.',
    status: 'STARTED' as const,
    priority: 'LOW' as const,
    assignee: 5,
    reporter: 2,
    thread: [
      { from: 2, text: 'Three states drawn: no results, no items yet, and error. Walkthrough is on the canvas.' },
      { from: 5, text: 'What should the loading state do — skeleton or spinner?' },
      { from: 2, text: 'Skeleton for lists, spinner only for actions. Consistency matters more than which one.' },
      { from: 5, text: 'Works for me, I\'ll build to that.' },
    ],
  },
  {
    title: 'Stale tickets should return to triage automatically',
    description:
      'Anything untouched for seven days goes back to triage instead of sitting in a stage nobody is watching. Implemented as an automation; this ticket tracks rolling it out to the other boards.',
    status: 'COMPLETED' as const,
    priority: 'LOW' as const,
    assignee: 0,
    reporter: 0,
    thread: [
      { from: 0, text: 'Live on Delivery since Monday. Twelve tickets moved back to triage on the first run, which is about what I expected.' },
      { from: 1, text: 'Any complaints?' },
      { from: 0, text: 'One, from someone who had a ticket parked deliberately. Added a \'pinned\' exemption for that case.' },
      { from: 1, text: 'Sensible. Rolling it out to the other boards this week.' },
    ],
  },
  {
    title: 'Add date and sender filters to search',
    description:
      'Raised in #engineering — people can find a phrase but not narrow it to a period or a person, so they give up. Filters exist in the backend; the UI does not expose them.',
    status: 'STARTED' as const,
    priority: 'HIGH' as const,
    assignee: 5,
    reporter: 5,
    thread: [
      { from: 5, text: 'The filters exist server-side, they\'re just not exposed anywhere in the UI.' },
      { from: 1, text: 'People are compensating by scrolling, which works right up until it doesn\'t.' },
      { from: 5, text: 'Design is straightforward — a date range and a person picker in the search bar.' },
      { from: 0, text: 'Ship the date one first if they\'re separable. That\'s the one I reach for daily.' },
    ],
  },
  {
    title: 'Auto-open a ticket when error rate crosses threshold',
    description:
      'Agent watches the error rate and opens a ticket assigned to on-call, deduped on the alert key so one incident produces one ticket. Follow-up: tune the threshold per service.',
    status: 'COMPLETED' as const,
    priority: 'MEDIUM' as const,
    assignee: 1,
    reporter: 1,
    thread: [
      { from: 1, text: 'Running for a week. Four incidents, four tickets, no duplicates.' },
      { from: 0, text: 'How\'s the threshold?' },
      { from: 1, text: 'Slightly twitchy on the payments service — it spikes briefly on deploy and that\'s normal.' },
      { from: 0, text: 'Per-service thresholds then, rather than one global number.' },
      { from: 1, text: 'Agreed, that\'s the follow-up.' },
    ],
  },
  {
    title: 'Post ticket summary to the originating channel on Done',
    description:
      'Automation closing the loop so the channel that raised something learns it shipped. Currently enabled on the Delivery board only.',
    status: 'STARTED' as const,
    priority: 'LOW' as const,
    assignee: 5,
    reporter: 3,
    thread: [
      { from: 5, text: 'Enabled on Delivery. When a ticket hits Done it posts a summary back to the channel it came from.' },
      { from: 3, text: 'Does it include who closed it?' },
      { from: 5, text: 'Yes, and the stage history, so you can see how long it sat where.' },
      { from: 4, text: 'This kills the \'whatever happened to that\' question entirely.' },
    ],
  },
  {
    title: 'Stage ETAs missing on In Review',
    description:
      'No ETA on the In Review stage means no reminders fire and tickets sit there unnoticed. Set an ETA and confirm the reminder automation picks it up.',
    status: 'TODO' as const,
    priority: 'MEDIUM' as const,
    assignee: 3,
    reporter: 0,
    thread: [
      { from: 3, text: 'In Review has no ETA, so the reminder automation has nothing to fire against.' },
      { from: 0, text: 'That explains a lot about In Review.' },
      { from: 3, text: 'Setting it to two days to match what we actually expect.' },
      { from: 0, text: 'Confirm the reminders fire before we call it done.' },
    ],
  },
  {
    title: 'Canvas links in tickets should stay live',
    description:
      'Design wants a component link in a ticket to always point at the current frame rather than a snapshot. Confirm behaviour and document it.',
    status: 'TODO' as const,
    priority: 'LOW' as const,
    assignee: 2,
    reporter: 2,
    thread: [
      { from: 2, text: 'Want a component link in a ticket to always point at the current frame, not a copy from the day it was linked.' },
      { from: 5, text: 'Otherwise the ticket slowly becomes a lie.' },
      { from: 2, text: 'Exactly. Need to confirm that\'s the behaviour and then write it down.' },
    ],
  },
  {
    title: 'Include call transcripts in search results',
    description:
      'Transcripts are indexed but ranked below messages, so they rarely surface. Adjust weighting and verify with the pricing-decision call as the test case.',
    status: 'COMPLETED' as const,
    priority: 'HIGH' as const,
    assignee: 1,
    reporter: 0,
    thread: [
      { from: 1, text: 'Transcripts were indexed but ranked so far below messages they never surfaced.' },
      { from: 0, text: 'Test case is the pricing call — search \'pricing decision\' and it should come back.' },
      { from: 1, text: 'It does now. Weighting adjusted, and it\'s above the messages that just mention pricing in passing.' },
      { from: 0, text: 'That\'s the one I\'ve wanted since we turned recording on.' },
    ],
  },
];
