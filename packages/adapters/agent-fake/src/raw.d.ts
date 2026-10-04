// Vite / Vitest `?raw` imports, used for fixtures.
declare module '*?raw' {
  const content: string;
  export default content;
}
