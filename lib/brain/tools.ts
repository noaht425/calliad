import type Anthropic from '@anthropic-ai/sdk';

// Stage 1 of the tool-calling migration. Instead of ~25 regex guards each with
// its own extractor, the model gets these tools + the full conversation and
// picks. The executor (in app/api/chat/route.ts) runs each call through the
// existing trust-ladder / gate machinery — the tool is the extraction, the gate
// still gates. Only the calendar / task / class-schedule / note cluster lives
// here so far; everything else stays on the regex path behind `chatToolsOn`.

// Deliberately generous "might this want a tool?" pre-filter. Its only job is
// to keep obvious chit-chat ("thanks", "how's it going", "what do you think of
// X", "explain Y") off the tool-enabled path, since a false negative here
// resurrects the exact "falls through every handler" failure this migration is
// fixing. A false positive just costs one model call. So: err heavily toward
// true.
const ACTION_VERB =
  /\b(add|creat\w*|schedul\w*|put|book|pencil\w*|block(?:ed|ing)?|set(?:ting)? up|mov\w*|reschedul\w*|push(?:ed|ing)?|bump\w*|shift\w*|renam\w*|chang\w*|updat\w*|edit\w*|fix\w*|delet\w*|remov\w*|cancel\w*|scrap\w*|drop\w*|clear\w*|remind\w*|jot\w*|not(?:e|ed|ing)|remember\w*|mark\w*|finish\w*|complet\w*|log(?:ged|ging)?|track\w*|sav\w*|keep|kept|import\w*|watch\w*|read|reading|play\w*|rate[ds]?|rating|loved|hated|adored|binged?|bailed|go(?:ing)? to|head(?:ed|ing)? (?:to|out)|fly(?:ing)? (?:to|out)|trip to|visiting|talked to|spoke (?:to|with)|caught up|called|texted|met (?:up )?with|had (?:lunch|dinner|coffee) with)\b/i;
const ACTION_NOUN =
  /\b(calendar|schedule|class(?:es)?|assignments?|syllab\w*|shifts?|exams?|midterms?|quiz(?:zes)?|tests?|deadlines?|appointments?|appts?|meetings?|events?|tasks?|to-?dos?|reminders?|notes?|watch ?list|show|series|movie|film|episode|season|book|game|trip)\b/i;

// Lookup phrasings — "what's on my list", "would I like X", "recommend a
// place", "what am I paying for". These want a tool that fetches data the model
// then speaks, so they also need to reach the tool path.
const LOOKUP =
  /\b(what'?s on|what am i|what do i (have|owe)|how much (am i|do i)|recommend|suggestions?|any (recs|recommendations|ideas)|where should i|what should i (watch|read|play|do|eat|see)|would i (like|enjoy|hate)|should i (watch|read|play|start|bother|see|go)|do you think i'?d|worth (watching|reading|playing|seeing|a (visit|watch|read|go))|what did i (rate|think|give)|have i (seen|read|played|watched|been|tried|rated)|my (subscriptions?|watch ?list|list|ratings?)|paying for)\b/i;

export function looksActionable(text: string): boolean {
  return ACTION_VERB.test(text) || ACTION_NOUN.test(text) || LOOKUP.test(text) || /\b(to|on|off)\b.{0,12}\bmy\b/i.test(text);
}

/** Tools whose result is context for the model to speak, not a confirmation to
 *  append. Any of these in a turn forces the follow-up model call. */
export const LOOKUP_TOOL_NAMES = new Set([
  'list_watchlist', 'restaurant_suggestion', 'would_i_like', 'list_subscriptions', 'search_my_notes',
]);

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_calendar_event',
    description:
      "Put a new event on Noah's calendar. Use for something Noah himself is doing or attending: appointments, meetings, plans, one-off commitments. Resolve relative dates/times against the current time given in the context. If a time is given with no end, omit end_at (defaults to 1 hour). Use all_day only when no clock time is implied. Do NOT use this for a class that meets weekly (that's the fixed class schedule) or for a recurring to-do with no clock time (use add_task). Do NOT use this when Noah asks you to BOOK/ORDER/ARRANGE something (a rideshare, a delivery, a reservation, a purchase) — you have no way to actually do that regardless of whether it has a time attached, so say so plainly instead of quietly logging a reminder as if it were the booking. A calendar entry is never a substitute for an action you can't perform.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short event title.' },
        start_at: { type: 'string', description: 'Start, ISO 8601 with timezone offset.' },
        end_at: { type: 'string', description: 'End, ISO 8601. Omit if not stated.' },
        all_day: { type: 'boolean', description: 'True only for all-day events with no clock time.' },
        location: { type: 'string', description: 'Venue or address if given.' },
      },
      required: ['title', 'start_at'],
    },
  },
  {
    name: 'update_calendar_event',
    description:
      "Move, rename, or relocate an event that's already on Noah's calendar. `match` is how Noah refers to the existing event (title words plus any day/time he gives to identify it), never the new time. Set only the fields that change.",
    input_schema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'How Noah identifies the existing event, e.g. "standup tomorrow", "dentist Friday".' },
        new_start_at: { type: 'string', description: 'New start, ISO 8601. Omit if the time is not changing.' },
        new_end_at: { type: 'string', description: 'New end, ISO 8601. Omit unless stated.' },
        new_title: { type: 'string', description: 'New title. Omit if not renaming.' },
        new_location: { type: 'string', description: 'New location. Omit if not moving it.' },
      },
      required: ['match'],
    },
  },
  {
    name: 'delete_calendar_event',
    description:
      "Cancel or remove a one-off event from Noah's calendar. `match` identifies it (title plus any day/time). For a weekly class Noah is dropping, use drop_class instead.",
    input_schema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'How Noah identifies the event to remove.' },
      },
      required: ['match'],
    },
  },
  {
    name: 'drop_class',
    description:
      "Noah dropped a class and wants it off his schedule for the rest of the term. `name` is the class as he refers to it: a nickname (\"Voodoo\"), a subject (\"Latin\"), or a course code (\"ANTH-222\").",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The class name, subject, or course code.' } },
      required: ['name'],
    },
  },
  {
    name: 'restore_class',
    description: "Put a class Noah previously dropped back on his schedule (\"actually I'm keeping Voodoo\", \"add Latin back\").",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The class name, subject, or course code.' } },
      required: ['name'],
    },
  },
  {
    name: 'add_task',
    description:
      "Add a to-do / reminder with no clock time of its own (\"remind me to email the landlord\", \"add milk to the list\", \"file the timesheet by Friday\"). Set due_at only if a day or deadline is clearly stated. Set recur only if it clearly repeats.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task, imperative, no date or repeat words.' },
        due_at: { type: 'string', description: 'ISO 8601, a sensible time (default 9am local). Omit if no deadline.' },
        recur: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'], description: 'Only if it repeats.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'edit_task',
    description: "Change the wording of a task already on Noah's list. `match` identifies the existing task by its current title words.",
    input_schema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'Words identifying the existing task.' },
        new_title: { type: 'string', description: 'What the task should say now.' },
      },
      required: ['match', 'new_title'],
    },
  },
  {
    name: 'complete_task',
    description: "Mark a task on Noah's list done (\"finished the reading\", \"did the timesheet\", \"checked off X\").",
    input_schema: {
      type: 'object',
      properties: { match: { type: 'string', description: 'Words identifying the task he finished.' } },
      required: ['match'],
    },
  },
  {
    name: 'import_calendar_items',
    description:
      "Add several events to Noah's calendar in one go: he pasted a list of assignments, exam dates, or work shifts. Prefer this over calling create_calendar_event repeatedly when there are 2 or more items. Each item needs a title and a start time; use all_day: true for a date-only deadline (e.g. \"essay due Oct 3\"). Resolve relative/partial dates against the current time in context; if the year isn't given use the current one unless that puts the date in the past.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The events to add.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              start_at: { type: 'string', description: 'ISO 8601 with timezone offset.' },
              end_at: { type: 'string', description: 'ISO 8601. Omit for all-day or unknown.' },
              all_day: { type: 'boolean' },
              location: { type: 'string' },
            },
            required: ['title', 'start_at'],
          },
        },
        label: { type: 'string', description: 'Short name for the batch, e.g. "CLCV-390 assignments", "shifts week of Sep 15".' },
      },
      required: ['items'],
    },
  },
  {
    name: 'remember_note',
    description:
      "Save a durable fact or detail to Noah's notes so it's searchable later (\"the storage code is 4417\", \"the car's due for service in March\", \"Priya's kid is called Sam\"). Not for tasks, not for calendar events, not for passing small talk.",
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The note, one concise standalone sentence, keep the specifics.' } },
      required: ['text'],
    },
  },
  {
    name: 'add_to_watchlist',
    description:
      "Add a show, film, or anything watchable to Noah's watch list (\"add Lanterns to my list\", \"I should watch the new Dune\", \"start tracking Shogun\"). status is 'watching' if he's already started it, else 'want'.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title as Noah said it.' },
        status: { type: 'string', enum: ['want', 'watching'], description: "'watching' if he's begun it, else 'want'." },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_watchlist_item',
    description:
      "Record progress or a rating on something already on Noah's watch list (\"I'm on season 3 of The Bear\", \"rate Severance 5 stars\", \"finished Shogun\", \"gave up on that one\"). Set only the fields he stated.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Which item on the list.' },
        rating: { type: 'number', description: '1 to 5.' },
        on_season: { type: 'number', description: 'The season he is currently on.' },
        finished_season: { type: 'number', description: 'A single season he just finished.' },
        finished: { type: 'boolean', description: 'True if he finished the whole thing / is all caught up.' },
        status: { type: 'string', enum: ['want', 'watching', 'done'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'log_media_reaction',
    description:
      "Log Noah's verdict on a specific book / show / film / game / album he read, watched, or played (\"loved Piranesi\", \"that movie was mid\", \"bailed on the new one\", \"Hades II is fantastic\"). Not for a plan to watch something (that's add_to_watchlist).",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Canonical title only.' },
        kind: { type: 'string', enum: ['book', 'screen', 'game', 'music', 'other'] },
        verdict: { type: 'string', enum: ['loved', 'liked', 'fine', 'bailed', 'hated'], description: "'bailed' = started, didn't finish. 'fine' = lukewarm." },
        why: { type: 'string', description: 'His reason, a short phrase. Omit if none given.' },
      },
      required: ['title', 'verdict'],
    },
  },
  {
    name: 'log_contact',
    description:
      "Record that Noah saw / talked to / called / texted someone (\"caught up with Dad\", \"lunch with Priya\", \"called my sister\"). Just the name; this only works for people already in his contacts.",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The person, as Noah refers to them.' } },
      required: ['name'],
    },
  },
  {
    name: 'plan_trip',
    description:
      "Record an upcoming trip so Calliad can nudge Noah on prep (bank, mail hold, airport plan) as it nears (\"I'm going to Chicago March 3 to 10\", \"heading to NYC next weekend\"). Needs a real destination and at least a start date.",
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: '"City, Country" or "City, ST".' },
        start_date: { type: 'string', description: 'YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD. Omit if one-day or unknown.' },
        has_pet: { type: 'boolean', description: 'True only if he mentions bringing a pet.' },
      },
      required: ['destination', 'start_date'],
    },
  },
  {
    name: 'list_watchlist',
    description:
      "Look at Noah's watch list to answer a question about it (\"what's on my list\", \"what should I watch next\", \"anything airing soon\"). filter 'airing' for what has a new episode/season coming; otherwise omit or use 'watching' / 'want'.",
    input_schema: {
      type: 'object',
      properties: { filter: { type: 'string', enum: ['all', 'watching', 'want', 'airing'] } },
      required: [],
    },
  },
  {
    name: 'would_i_like',
    description:
      "Check Noah's taste history to judge whether he'd like a specific book / show / film / game / restaurant, or to recall his verdict on one (\"would I like Dune\", \"what did I rate Severance\", \"have I been to that place\"). title is the work or place.",
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'The specific work or restaurant.' } },
      required: ['title'],
    },
  },
  {
    name: 'restaurant_suggestion',
    description:
      "Pull Noah's restaurant taste + nearby options when he wants somewhere to eat or drink (\"where should I eat\", \"somewhere good for tacos near Cambridge\", \"dinner spot for a date\"). Put his ask (cuisine, area, occasion) in query.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Cuisine / area / occasion, roughly as Noah said it.' } },
      required: [],
    },
  },
  {
    name: 'list_subscriptions',
    description: "Summarise what Noah is paying for on a recurring basis (\"what am I paying for\", \"list my subscriptions\", \"how much on streaming\").",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_my_notes',
    description:
      "Search Noah's own saved notes for a detail he told Calliad before (\"what's the storage code\", \"what did I say about the landlord\", \"when's the deadline for X\"). query is what he's trying to recall.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What he is trying to recall.' } },
      required: ['query'],
    },
  },
];
