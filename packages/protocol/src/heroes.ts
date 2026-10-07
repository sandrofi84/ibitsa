/**
 * A hero's @handle (#83): its name in lower case with dashes, e.g. "Ranger Ilse" → `ranger-ilse`. The
 * game's command bar and the extension's Command Palette (#125) both address heroes by it.
 */
export function heroHandle(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
