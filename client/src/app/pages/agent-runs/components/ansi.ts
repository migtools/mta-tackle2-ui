/**
 * Minimal ANSI SGR rendering for the run log viewer: the codes the agent
 * harness actually emits (reset, bold, and the 16 foreground colors).
 * Anything else passes through as text.
 */

export interface AnsiSpan {
  text: string;
  className?: string;
}

const COLORS: Record<number, string> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "bright-black",
  91: "bright-red",
  92: "bright-green",
  93: "bright-yellow",
  94: "bright-blue",
  95: "bright-magenta",
  96: "bright-cyan",
  97: "bright-white",
};

/** Split a log line into colored/bold spans, stripping SGR sequences. */
export function ansiToSpans(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  const classes = new Set<string>();
  let text = "";
  const flush = () => {
    if (text) {
      spans.push({
        text,
        ...(classes.size ? { className: [...classes].join(" ") } : {}),
      });
      text = "";
    }
  };
  // Built from String.fromCharCode so no control character appears in the
  // source (eslint no-control-regex).
  const sgr = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  let at = 0;
  for (const match of line.matchAll(sgr)) {
    const seq = match[0];
    text += line.slice(at, match.index);
    at = match.index + seq.length;
    flush();
    const params = seq
      .slice(2, -1)
      .split(";")
      .map((p) => (p === "" ? 0 : Number(p)));
    if (params[0] === 0 || params.length === 0) {
      classes.clear();
      continue;
    }
    for (const p of params) {
      if (p === 0) classes.clear();
      else if (p === 1) classes.add("ansi-bold");
      else if (COLORS[p]) classes.add(`ansi-${COLORS[p]}`);
    }
  }
  text += line.slice(at);
  flush();
  return spans;
}
