export const PROJECT_COLORS = [
  { name: 'stone',  bg: 'bg-zinc-400',    ring: 'ring-zinc-400' },
  { name: 'red',    bg: 'bg-red-400',     ring: 'ring-red-400' },
  { name: 'orange', bg: 'bg-orange-400',  ring: 'ring-orange-400' },
  { name: 'amber',  bg: 'bg-amber-400',   ring: 'ring-amber-400' },
  { name: 'green',  bg: 'bg-green-500',   ring: 'ring-green-500' },
  { name: 'teal',   bg: 'bg-teal-400',    ring: 'ring-teal-400' },
  { name: 'blue',   bg: 'bg-blue-400',    ring: 'ring-blue-400' },
  { name: 'violet', bg: 'bg-violet-400',  ring: 'ring-violet-400' },
  { name: 'pink',   bg: 'bg-pink-400',    ring: 'ring-pink-400' },
] as const;

export type ProjectColorName = typeof PROJECT_COLORS[number]['name'];

export function colorBg(name: string): string {
  return PROJECT_COLORS.find((c) => c.name === name)?.bg ?? 'bg-zinc-400';
}
