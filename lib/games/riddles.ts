// Curated riddles + lateral-thinking puzzles. Vetted, single clear answer.
// `keys` = words that must appear in a guess to count it right (lowercased,
// punctuation-stripped). `a` is the canonical answer shown on reveal.

export interface Riddle {
  q: string;
  a: string;
  keys: string[][]; // guess passes if it contains every word of ANY inner group
  hint?: string;
}

export const RIDDLES: Riddle[] = [
  { q: "The more of me you take, the more you leave behind. What am I?", a: "Footsteps.", keys: [["footstep"], ["footprint"], ["steps"]] },
  { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", a: "An echo.", keys: [["echo"]] },
  { q: "I have keys but no locks, space but no room, and you can enter but can't go outside. What am I?", a: "A keyboard.", keys: [["keyboard"], ["key", "board"]] },
  { q: "What has to be broken before you can use it?", a: "An egg.", keys: [["egg"]] },
  { q: "What has hands but cannot clap?", a: "A clock.", keys: [["clock"], ["watch"]] },
  { q: "The person who makes it has no need of it. The person who buys it has no use for it. The person who uses it can neither see nor feel it. What is it?", a: "A coffin.", keys: [["coffin"], ["casket"]] },
  { q: "What gets wetter the more it dries?", a: "A towel.", keys: [["towel"]] },
  { q: "I'm tall when I'm young, and short when I'm old. What am I?", a: "A candle.", keys: [["candle"], ["pencil"]] },
  { q: "What can travel around the world while staying in one corner?", a: "A stamp.", keys: [["stamp"]] },
  { q: "What has a head and a tail but no body?", a: "A coin.", keys: [["coin"], ["penny"]] },
  { q: "What has many needles but doesn't sew?", a: "A pine tree.", keys: [["pine"], ["christmas tree"], ["fir"], ["evergreen"]] },
  { q: "What has one eye but cannot see?", a: "A needle.", keys: [["needle"], ["hurricane"], ["storm"]] },
  { q: "What runs but never walks, has a mouth but never talks, has a bed but never sleeps?", a: "A river.", keys: [["river"], ["stream"]] },
  { q: "What comes down but never goes up?", a: "Rain.", keys: [["rain"]] },
  { q: "What can you catch but not throw?", a: "A cold.", keys: [["cold"], ["a cold"]] },
  { q: "What has a neck but no head?", a: "A bottle.", keys: [["bottle"], ["shirt"]] },
  { q: "What has words but never speaks?", a: "A book.", keys: [["book"]] },
  { q: "What has a thumb and four fingers but is not alive?", a: "A glove.", keys: [["glove"]] },
  { q: "What building has the most stories?", a: "A library.", keys: [["library"]] },
  { q: "What goes up and down but never moves?", a: "A staircase.", keys: [["stair"], ["staircase"], ["steps"], ["temperature"]] },
  { q: "Forward I am heavy, but backward I am not. What am I?", a: "The word \"ton\".", keys: [["ton"]], hint: "It's a word." },
  { q: "What five-letter word becomes shorter when you add two letters to it?", a: "Short (→ shorter).", keys: [["short"]] },
  { q: "What word is spelled incorrectly in every dictionary?", a: "\"Incorrectly.\"", keys: [["incorrectly"]] },
  { q: "What has 13 hearts but no other organs?", a: "A deck of cards.", keys: [["deck of cards"], ["cards"], ["playing cards"]] },
  { q: "If you have me, you want to share me. If you share me, you no longer have me. What am I?", a: "A secret.", keys: [["secret"]] },
  { q: "What can fill a room but takes up no space?", a: "Light.", keys: [["light"], ["sound"], ["air"]] },
  { q: "I have branches, but no fruit, trunk, or leaves. What am I?", a: "A bank.", keys: [["bank"]] },
  { q: "What is always in front of you but can't be seen?", a: "The future.", keys: [["future"]] },
  { q: "What breaks yet never falls, and what falls yet never breaks?", a: "Day breaks and night falls.", keys: [["day", "night"], ["dawn", "night"]] },
  { q: "A man describes his daughters: \"They are all blonde but two, all brunette but two, and all redheaded but two.\" How many daughters does he have?", a: "Three — one of each.", keys: [["three"], ["3"]] },
  { q: "What has a bark but no bite?", a: "A tree.", keys: [["tree"]] },
  { q: "You see a boat filled with people, yet there isn't a single person on board. How?", a: "Everyone on board is married.", keys: [["married"]], hint: "\"Single.\"" },
  { q: "What can't talk but will reply when spoken to?", a: "An echo.", keys: [["echo"]] },
  { q: "What has four wheels and flies?", a: "A garbage truck.", keys: [["garbage truck"], ["trash truck"], ["bin lorry"], ["dumpster"]] },
  { q: "The more you take away from me, the bigger I get. What am I?", a: "A hole.", keys: [["hole"], ["pit"], ["debt"]] },
  { q: "I go all around the world but never leave the corner. What am I?", a: "A stamp.", keys: [["stamp"]] },
  { q: "What kind of coat is best put on wet?", a: "A coat of paint.", keys: [["paint"]] },
  { q: "What has an eye but cannot see, and helps you make a shirt?", a: "A needle.", keys: [["needle"]] },
  { q: "Two fathers and two sons go fishing. Each catches one fish, yet only three fish are caught. How?", a: "They are a grandfather, a father, and a son.", keys: [["grandfather"], ["grandpa"], ["three generations"]] },
  { q: "What has to be given before it can be kept?", a: "A promise. (Also accepted: your word.)", keys: [["promise"], ["word"]] },
  { q: "What can you hold in your left hand but never in your right?", a: "Your right elbow.", keys: [["elbow"], ["right hand"], ["right arm"]] },
  { q: "What is so fragile that saying its name breaks it?", a: "Silence.", keys: [["silence"]] },
  { q: "A woman shoots her husband, holds him under water for five minutes, then hangs him. Ten minutes later they go out to dinner together. How?", a: "She's a photographer — she shot a photo, developed it, and hung it to dry.", keys: [["photo"], ["photograph"], ["picture"], ["camera"]] },
  { q: "What gets bigger the more you take from it, and there is nothing left when it's done?", a: "A hole (or a debt being paid).", keys: [["hole"], ["debt"]] },
  { q: "What invention lets you look right through a wall?", a: "A window.", keys: [["window"]] },
];
