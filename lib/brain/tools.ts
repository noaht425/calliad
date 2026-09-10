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
  /\b(add|creat\w*|schedul\w*|put|book|pencil\w*|block(?:ed|ing)?|set(?:ting)? up|mov\w*|reschedul\w*|push(?:ed|ing)?|bump\w*|shift\w*|renam\w*|chang\w*|updat\w*|edit\w*|fix\w*|delet\w*|remov\w*|cancel\w*|scrap\w*|drop\w*|clear\w*|remind\w*|jot\w*|not(?:e|ed|ing)|remember\w*|mark\w*|finish\w*|complet\w*|log(?:ged|ging)?|track\w*|sav\w*|keep|kept|import\w*)\b/i;
const ACTION_NOUN =
  /\b(calendar|schedule|class(?:es)?|assignments?|syllab\w*|shifts?|exams?|midterms?|quiz(?:zes)?|tests?|deadlines?|appointments?|appts?|meetings?|events?|tasks?|to-?dos?|reminders?|notes?)\b/i;

export function looksActionable(text: string): boolean {
  return ACTION_VERB.test(text) || ACTION_NOUN.test(text) || /\b(to|on|off)\b.{0,12}\bmy\b/i.test(text);
}

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_calendar_event',
    description:
      "Put a new event on Noah's calendar. Use for anything with a time or a date: appointments, meetings, plans, one-off commitments. Resolve relative dates/times against the current time given in the context. If a time is given with no end, omit end_at (defaults to 1 hour). Use all_day only when no clock time is implied. Do NOT use this for a class that meets weekly (that's the fixed class schedule) or for a recurring to-do with no clock time (use add_task).",
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
    name: 'remember_note',
    description:
      "Save a durable fact or detail to Noah's notes so it's searchable later (\"the storage code is 4417\", \"the car's due for service in March\", \"Priya's kid is called Sam\"). Not for tasks, not for calendar events, not for passing small talk.",
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The note, one concise standalone sentence, keep the specifics.' } },
      required: ['text'],
    },
  },
];
