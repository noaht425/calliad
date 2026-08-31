// Latin / Greek roots for the etymology drill. `english` = a few clean
// derivatives (used for both the prompt's accepted answers and the reveal).

export interface Root {
  root: string;
  lang: 'Latin' | 'Greek' | 'Greek/Latin';
  gloss: string;
  english: string[];
}

export const ROOTS: Root[] = [
  { root: 'aqua', lang: 'Latin', gloss: 'water', english: ['aquarium', 'aquatic', 'aqueduct', 'aquamarine'] },
  { root: 'ferō / ferre', lang: 'Latin', gloss: 'to carry, bear', english: ['transfer', 'refer', 'defer', 'infer', 'fertile', 'confer'] },
  { root: 'aud', lang: 'Latin', gloss: 'to hear', english: ['audience', 'audio', 'auditorium', 'audible', 'audition'] },
  { root: 'dic / dict', lang: 'Latin', gloss: 'to say, speak', english: ['dictate', 'predict', 'contradict', 'diction', 'verdict', 'edict'] },
  { root: 'scrib / script', lang: 'Latin', gloss: 'to write', english: ['scribe', 'describe', 'manuscript', 'inscription', 'prescribe', 'transcript'] },
  { root: 'port', lang: 'Latin', gloss: 'to carry', english: ['portable', 'transport', 'import', 'export', 'porter', 'report'] },
  { root: 'spec / spect', lang: 'Latin', gloss: 'to look, see', english: ['spectator', 'inspect', 'perspective', 'spectacle', 'suspect', 'respect'] },
  { root: 'vid / vis', lang: 'Latin', gloss: 'to see', english: ['video', 'vision', 'evident', 'visible', 'provide', 'supervise'] },
  { root: 'cred', lang: 'Latin', gloss: 'to believe, trust', english: ['credit', 'credible', 'incredible', 'credential', 'creed'] },
  { root: 'lūc', lang: 'Latin', gloss: 'light', english: ['lucid', 'translucent', 'elucidate', 'lucifer'] },
  { root: 'terra', lang: 'Latin', gloss: 'earth, land', english: ['terrain', 'territory', 'terrestrial', 'subterranean', 'terrace'] },
  { root: 'manus', lang: 'Latin', gloss: 'hand', english: ['manual', 'manufacture', 'manuscript', 'manage', 'manipulate'] },
  { root: 'ped', lang: 'Latin', gloss: 'foot', english: ['pedal', 'pedestrian', 'pedestal', 'biped', 'impede', 'expedite'] },
  { root: 'reg / rect', lang: 'Latin', gloss: 'to rule; straight', english: ['regal', 'regent', 'direct', 'correct', 'rectangle', 'regime'] },
  { root: 'cap / cept', lang: 'Latin', gloss: 'to take, seize', english: ['capture', 'accept', 'concept', 'intercept', 'receive', 'capable'] },
  { root: 'ten / tain', lang: 'Latin', gloss: 'to hold', english: ['tenant', 'retain', 'contain', 'maintain', 'tenacious', 'detain'] },
  { root: 'mit / miss', lang: 'Latin', gloss: 'to send', english: ['transmit', 'mission', 'dismiss', 'permit', 'submit', 'missile'] },
  { root: 'ven / vent', lang: 'Latin', gloss: 'to come', english: ['convene', 'event', 'invent', 'prevent', 'venue', 'intervene'] },
  { root: 'duc / duct', lang: 'Latin', gloss: 'to lead', english: ['conduct', 'produce', 'reduce', 'aqueduct', 'induce', 'educate'] },
  { root: 'flu / flux', lang: 'Latin', gloss: 'to flow', english: ['fluid', 'influence', 'fluent', 'flux', 'affluent', 'confluence'] },
  { root: 'greg', lang: 'Latin', gloss: 'flock, herd', english: ['gregarious', 'congregate', 'segregate', 'aggregate'] },
  { root: 'loqu / locu', lang: 'Latin', gloss: 'to speak', english: ['eloquent', 'loquacious', 'soliloquy', 'elocution', 'circumlocution'] },
  { root: 'sol', lang: 'Latin', gloss: 'sun', english: ['solar', 'solstice', 'parasol', 'solarium'] },
  { root: 'nov', lang: 'Latin', gloss: 'new', english: ['novel', 'novice', 'innovate', 'renovate', 'nova'] },
  { root: 'bene', lang: 'Latin', gloss: 'well, good', english: ['benefit', 'benevolent', 'benefactor', 'benign', 'benediction'] },
  { root: 'mal', lang: 'Latin', gloss: 'bad, ill', english: ['malice', 'malignant', 'malady', 'malfunction', 'malevolent'] },
  { root: 'omni', lang: 'Latin', gloss: 'all', english: ['omnivore', 'omnipotent', 'omniscient', 'omnipresent'] },
  { root: 'vor', lang: 'Latin', gloss: 'to devour', english: ['carnivore', 'herbivore', 'voracious', 'devour'] },
  { root: 'annus', lang: 'Latin', gloss: 'year', english: ['annual', 'anniversary', 'biennial', 'perennial', 'annals'] },
  { root: 'corpus', lang: 'Latin', gloss: 'body', english: ['corporal', 'corpse', 'corporation', 'incorporate', 'corps'] },
  { root: 'anthrop', lang: 'Greek', gloss: 'human, man', english: ['anthropology', 'philanthropy', 'misanthrope', 'anthropomorphic'] },
  { root: 'bio', lang: 'Greek', gloss: 'life', english: ['biology', 'biography', 'antibiotic', 'symbiosis', 'biosphere'] },
  { root: 'chron', lang: 'Greek', gloss: 'time', english: ['chronology', 'chronic', 'synchronize', 'anachronism', 'chronicle'] },
  { root: 'phil', lang: 'Greek', gloss: 'love, fondness', english: ['philosophy', 'philanthropy', 'bibliophile', 'philharmonic'] },
  { root: 'phon', lang: 'Greek', gloss: 'sound, voice', english: ['telephone', 'symphony', 'phonetic', 'cacophony', 'megaphone'] },
  { root: 'graph / gram', lang: 'Greek', gloss: 'to write; drawing', english: ['photograph', 'grammar', 'diagram', 'telegram', 'biography', 'graphic'] },
  { root: 'log / logos', lang: 'Greek', gloss: 'word, reason, study', english: ['logic', 'dialogue', 'monologue', 'biology', 'analogy', 'catalogue'] },
  { root: 'geo', lang: 'Greek', gloss: 'earth', english: ['geography', 'geology', 'geometry', 'geopolitics'] },
  { root: 'hydr', lang: 'Greek', gloss: 'water', english: ['hydrant', 'dehydrate', 'hydraulic', 'hydrogen', 'hydroplane'] },
  { root: 'therm', lang: 'Greek', gloss: 'heat', english: ['thermometer', 'thermal', 'thermostat', 'hypothermia'] },
  { root: 'path', lang: 'Greek', gloss: 'feeling, suffering, disease', english: ['sympathy', 'empathy', 'pathology', 'apathy', 'pathetic'] },
  { root: 'psych', lang: 'Greek', gloss: 'mind, soul', english: ['psychology', 'psyche', 'psychic', 'psychiatry'] },
  { root: 'poli / polis', lang: 'Greek', gloss: 'city', english: ['politics', 'metropolis', 'police', 'cosmopolitan', 'acropolis'] },
  { root: 'auto', lang: 'Greek', gloss: 'self', english: ['automatic', 'autonomy', 'autograph', 'autobiography', 'automobile'] },
  { root: 'micro', lang: 'Greek', gloss: 'small', english: ['microscope', 'microphone', 'microbe', 'microcosm'] },
  { root: 'tele', lang: 'Greek', gloss: 'far, distant', english: ['telephone', 'television', 'telescope', 'telepathy'] },
  { root: 'scop', lang: 'Greek', gloss: 'to look at, examine', english: ['telescope', 'microscope', 'periscope', 'stethoscope'] },
  { root: 'dem / demos', lang: 'Greek', gloss: 'people', english: ['democracy', 'demographic', 'epidemic', 'endemic', 'demagogue'] },
  { root: 'kratos / cracy', lang: 'Greek', gloss: 'power, rule', english: ['democracy', 'aristocracy', 'autocracy', 'bureaucracy', 'theocracy'] },
  { root: 'gen', lang: 'Greek/Latin', gloss: 'birth, origin, kind', english: ['generate', 'genesis', 'genetic', 'genre', 'gene', 'indigenous'] },
  { root: 'morph', lang: 'Greek', gloss: 'form, shape', english: ['morphology', 'metamorphosis', 'amorphous', 'polymorphous'] },
  { root: 'onym / onoma', lang: 'Greek', gloss: 'name', english: ['synonym', 'antonym', 'pseudonym', 'anonymous', 'onomatopoeia'] },
];
