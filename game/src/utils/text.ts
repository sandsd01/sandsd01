// "an axe" but "a pickaxe", "an Anvil" but "a Forge". These strings are read
// as sentences next to a disabled button, so they should be grammatical ones.
export function indefinite(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}
