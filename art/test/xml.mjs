// A small, strict XML parser for the SVGs the generators emit (test helper).
// It checks well-formedness (one root, balanced tags, quoted attributes, no
// duplicate attributes, valid entities, no raw "<" or "&" in text or values)
// and returns every element with its attributes for the grammar checks.

const NAME = /^[A-Za-z_][\w.:-]*/;
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function checkAmps(s, where, errors) {
  for (let i = s.indexOf("&"); i >= 0; i = s.indexOf("&", i + 1)) {
    if (!ENTITY.test(s.slice(i))) errors.push(`${where}: bare "&" at ${JSON.stringify(s.slice(i, i + 12))}`);
  }
}

/** Parse an XML string. Returns { errors: string[], elements: {name, attrs, depth}[], texts: string[] }. */
export function parseXml(src) {
  const errors = [];
  const elements = [];
  const texts = [];
  const stack = [];
  let i = 0;
  let rootClosed = false;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const text = src.slice(i, lt < 0 ? src.length : lt);
    if (text.length) {
      if (!stack.length && text.trim()) errors.push(`text outside the root: ${JSON.stringify(text.slice(0, 20))}`);
      checkAmps(text, "text", errors);
      texts.push(text);
    }
    if (lt < 0) break;
    if (rootClosed) {
      errors.push("content after the root element");
      break;
    }
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) {
        errors.push("unterminated comment");
        break;
      }
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) {
      errors.push(`declaration or instruction not allowed inline: ${src.slice(lt, lt + 12)}`);
      i = src.indexOf(">", lt) + 1 || src.length;
      continue;
    }
    if (src.startsWith("</", lt)) {
      const m = NAME.exec(src.slice(lt + 2));
      if (!m) {
        errors.push(`bad closing tag at ${lt}`);
        break;
      }
      const close = src.indexOf(">", lt);
      if (src.slice(lt + 2 + m[0].length, close).trim()) errors.push(`junk in closing tag </${m[0]}>`);
      const open = stack.pop();
      if (open !== m[0]) errors.push(`</${m[0]}> closes <${open}>`);
      if (!stack.length) rootClosed = true;
      i = close + 1;
      continue;
    }
    // start tag
    const m = NAME.exec(src.slice(lt + 1));
    if (!m) {
      errors.push(`bad "<" at ${lt}: ${JSON.stringify(src.slice(lt, lt + 10))}`);
      break;
    }
    if (!stack.length && elements.length) errors.push("more than one root element");
    const name = m[0];
    const attrs = {};
    let j = lt + 1 + name.length;
    let selfClose = false;
    for (;;) {
      const ws = /^\s*/.exec(src.slice(j))[0].length;
      j += ws;
      if (src.startsWith("/>", j)) {
        selfClose = true;
        j += 2;
        break;
      }
      if (src[j] === ">") {
        j += 1;
        break;
      }
      if (!ws) {
        errors.push(`<${name}>: attributes must be separated by whitespace`);
        break;
      }
      const an = NAME.exec(src.slice(j));
      if (!an) {
        errors.push(`<${name}>: bad attribute at ${JSON.stringify(src.slice(j, j + 12))}`);
        break;
      }
      j += an[0].length;
      if (src[j] !== "=") {
        errors.push(`<${name}> ${an[0]}: missing "="`);
        break;
      }
      const q = src[j + 1];
      if (q !== '"' && q !== "'") {
        errors.push(`<${name}> ${an[0]}: unquoted value`);
        break;
      }
      const end = src.indexOf(q, j + 2);
      if (end < 0) {
        errors.push(`<${name}> ${an[0]}: unterminated value`);
        break;
      }
      const value = src.slice(j + 2, end);
      if (value.includes("<")) errors.push(`<${name}> ${an[0]}: "<" in value`);
      checkAmps(value, `<${name}> ${an[0]}`, errors);
      if (an[0] in attrs) errors.push(`<${name}>: duplicate attribute ${an[0]}`);
      attrs[an[0]] = value;
      j = end + 1;
    }
    elements.push({ name, attrs, depth: stack.length });
    if (selfClose) {
      if (!stack.length) rootClosed = true;
    } else stack.push(name);
    i = j;
  }
  if (stack.length) errors.push(`unclosed: <${stack.join("> <")}>`);
  if (!elements.length) errors.push("no root element");
  return { errors, elements, texts };
}

/** Every id defined in the document. */
export const idsOf = (doc) => doc.elements.map((e) => e.attrs.id).filter((x) => x != null);

/** Every internal reference: url(#x), href="#x", aria-labelledby/-describedby tokens. */
export function refsOf(doc) {
  const out = [];
  for (const e of doc.elements) {
    for (const [k, v] of Object.entries(e.attrs)) {
      for (const m of v.matchAll(/url\(#([^)]+)\)/g)) out.push(m[1]);
      if ((k === "href" || k === "xlink:href") && v.startsWith("#")) out.push(v.slice(1));
      if (k === "aria-labelledby" || k === "aria-describedby") out.push(...v.split(/\s+/).filter(Boolean));
    }
  }
  return out;
}
