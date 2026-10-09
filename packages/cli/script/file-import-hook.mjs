/** Handle Bun-style file imports while running source through tsx. */
export function load(url, context, nextLoad) {
  if (context.importAttributes?.type === "file") {
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(new URL(url).pathname)};`,
    };
  }
  return nextLoad(url, context);
}
