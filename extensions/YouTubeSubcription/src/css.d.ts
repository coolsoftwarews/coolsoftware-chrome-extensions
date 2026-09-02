/** esbuild is configured to load `.css` imports as text (see scripts/build.mjs). */
declare module '*.css' {
  const contents: string;
  export default contents;
}
