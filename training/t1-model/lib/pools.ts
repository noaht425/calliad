// Generic entity pools for synthetic examples. Deliberately NOT Noah's real
// contacts/places/history — this data leaves the machine (a training
// platform), so it's built from invented names and common public venues only.

export const PEOPLE = [
  'Jordan', 'Priya', 'Marcus', 'Elena', 'Sam', 'Dana', 'Theo', 'Nina', 'Caleb', 'Ruth',
  'Owen', 'Fatima', 'Leo', 'Grace', 'Ana', 'Ben', 'Yuki', 'Maya', 'Diego', 'Ivy',
  'Aunt Carol', 'my brother', 'my sister', 'Mom', 'Dad', 'my roommate', 'my manager',
];

export const EVENT_TITLES = [
  'dentist appointment', 'team standup', 'dinner', 'coffee', 'lunch', 'the game',
  'a checkup', 'the flight', 'the concert', 'movie night', 'the interview',
  'a haircut', 'the recital', 'book club', 'game night', 'the meeting', 'brunch',
  'the vet appointment', 'yoga class', 'the wedding', 'a walk', 'trivia night',
];

export const PLACES = [
  'the office', 'downtown', 'the usual spot', 'her place', 'the gym', 'the clinic',
  'the park', 'Riverside Cafe', 'the airport', "Tony's Diner", null, null, null,
];

export const CITIES = [
  'Boston', 'Chicago', 'Denver', 'Austin', 'Portland', 'Miami', 'Nashville',
  'San Diego', 'Minneapolis', 'Atlanta', 'Kirkland', 'New York', 'Seattle',
];

export const IATA: Record<string, string> = {
  Boston: 'BOS', Chicago: 'ORD', Denver: 'DEN', Austin: 'AUS', Portland: 'PDX',
  Miami: 'MIA', Nashville: 'BNA', 'San Diego': 'SAN', Minneapolis: 'MSP',
  Atlanta: 'ATL', 'New York': 'JFK', Seattle: 'SEA',
};

export const RESTAURANTS = [
  'Sushi Kashiba', 'The Corner Bistro', "Tony's", 'Nobu', 'the new ramen place',
  'that Thai spot on 5th', 'the steakhouse downtown', 'Pasta Bar', 'the taco truck',
];

export const TASK_VERBS = [
  'email the landlord', 'call the plumber', 'pick up groceries', 'renew my passport',
  'water the plants', 'return the package', 'submit the report', 'pay the electric bill',
  'book the vet appointment', 'follow up with HR', 'clean the garage', 'file taxes',
  'schedule a checkup', 'reply to the invite', 'update the spreadsheet',
];

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function maybe<T>(arr: readonly T[], pNull = 0.35): T | null {
  return Math.random() < pNull ? null : pick(arr);
}
