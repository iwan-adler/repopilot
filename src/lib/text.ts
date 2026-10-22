/** "1 file", "3 files", "1 dependency", "2 dependencies". */
export function plural(n: number, word: string, pluralForm = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralForm}`;
}
