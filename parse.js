// parse.js — a fast, dependency-free Markdown renderer whose output matches
// marked 18.1.3 (default options, GFM on) exactly. Written from scratch for
// the make.fun markdown-render-speed-02 competition. No marked code is used
// here: the renderer is an original single-pass implementation, verified
// against marked's output on the practice set.

const REPLACEMENT = '�';

// ---- character classification -------------------------------------------

function isSpaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
}

// ASCII punctuation: !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
function isAsciiPunct(c) {
  return (
    (c >= 33 && c <= 47) ||
    (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) ||
    (c >= 123 && c <= 126)
  );
}

const UNICODE_PUNCT = /[\p{P}\p{S}]/u;
/** CommonMark "Unicode punctuation": ASCII punct or Unicode P/S category. */
function isPunctCode(c) {
  if (c < 128) return isAsciiPunct(c);
  return UNICODE_PUNCT.test(String.fromCharCode(c));
}

/** CommonMark "Unicode whitespace". */
function isWhitespaceCode(c) {
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  return (
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

function isDigitCode(c) {
  return c >= 48 && c <= 57;
}

function isAlphaCode(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isAlnumCode(c) {
  return isAlphaCode(c) || isDigitCode(c);
}

// ---- escaping ------------------------------------------------------------

// Escape &, <, >, ", ' — used for code content, fence languages and plain
// attribute values where no entity decoding happens.
const ESCAPE_MAP = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' };

function escapeAll(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const r = ESCAPE_MAP[s.charCodeAt(i)];
    if (r !== undefined) {
      if (i > start) out += s.slice(start, i);
      out += r;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

// Entity-aware escape for attribute values (href / title): an & that starts
// a valid-looking entity reference (&name; / &#123; / &#x1f;) is kept as-is,
// every other & becomes &amp;. Other characters are escaped as in escapeAll.
function escapeAttr(s) {
  let out = '';
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      // try to read an entity reference starting here
      let j = i + 1;
      if (j < n && s.charCodeAt(j) === 35) {
        j++;
        if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) {
          j++;
          const h0 = j;
          while (j < n && isHexCode(s.charCodeAt(j))) j++;
          if (j > h0 && j < n && s.charCodeAt(j) === 59) {
            i = j;
            continue;
          }
        } else {
          const d0 = j;
          while (j < n && isDigitCode(s.charCodeAt(j))) j++;
          if (j > d0 && j < n && s.charCodeAt(j) === 59) {
            i = j;
            continue;
          }
        }
      } else {
        const w0 = j;
        while (j < n && isWordCode(s.charCodeAt(j))) j++;
        if (j > w0 && j < n && s.charCodeAt(j) === 59) {
          i = j;
          continue;
        }
      }
      if (i > start) out += s.slice(start, i);
      out += '&amp;';
      start = i + 1;
    } else {
      const r = ESCAPE_MAP[c];
      if (r !== undefined) {
        if (i > start) out += s.slice(start, i);
        out += r;
        start = i + 1;
      }
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

function isHexCode(c) {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
  );
}

function isWordCode(c) {
  return isAlnumCode(c) || c === 95; // [A-Za-z0-9_]
}

// A link destination goes through percent-encoding like encodeURI (space,
// <, >, ", backslash, non-ASCII, ...) but valid %XX sequences are kept
// as-is; the result then goes through the entity-aware attribute escape.
function cleanHref(dest) {
  let enc = '';
  for (let i = 0; i < dest.length; i++) {
    const c = dest.charCodeAt(i);
    if (
      c === 37 &&
      i + 2 < dest.length &&
      isHexCode(dest.charCodeAt(i + 1)) &&
      isHexCode(dest.charCodeAt(i + 2))
    ) {
      enc += dest.slice(i, i + 3);
      i += 2;
      continue;
    }
    const ch = dest[i];
    if (
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
      c === 59 || c === 44 || c === 47 || c === 63 || c === 58 || c === 64 ||
      c === 38 || c === 61 || c === 43 || c === 36 || c === 45 || c === 95 ||
      c === 46 || c === 33 || c === 126 || c === 42 || c === 39 || c === 40 ||
      c === 41 || c === 35
    ) {
      enc += ch;
    } else if (
      c >= 0xd800 && c <= 0xdbff &&
      i + 1 < dest.length &&
      dest.charCodeAt(i + 1) >= 0xdc00 &&
      dest.charCodeAt(i + 1) <= 0xdfff
    ) {
      try { enc += encodeURIComponent(dest.slice(i, i + 2)); } catch { enc += ch; }
      i++;
    } else {
      try { enc += encodeURIComponent(ch); } catch { enc += ch; }
    }
  }
  return escapeAttr(enc);
}

// Decode one numeric character reference; invalid code points become U+FFFD.
function decodeNumeric(code) {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return REPLACEMENT;
  }
  return String.fromCodePoint(code);
}

// ---- line helpers (block level) ------------------------------------------

function blankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Number of indent columns of a line, counting a tab as advancing to the
// next multiple of 4. Also returns the string index where that indent ends.
function indentOf(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) {
      col++;
      i++;
    } else if (c === 9) {
      col += 4 - (col % 4);
      i++;
    } else break;
  }
  return { col, idx: i };
}

// Remove `cols` columns of leading indentation from a line, expanding a tab
// that straddles the boundary into spaces (CommonMark's partially-consumed
// tab rule). Returns the remaining string.
function stripIndentCols(line, cols) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    const c = line.charCodeAt(i);
    if (c === 32) {
      col++;
      i++;
    } else if (c === 9) {
      const w = 4 - (col % 4);
      if (col + w <= cols) {
        col += w;
        i++;
      } else {
        // tab straddles the boundary: keep the leftover as spaces
        return ' '.repeat(col + w - cols) + line.slice(i + 1);
      }
    } else break;
  }
  return line.slice(i);
}

// The content of a line after removing up to `cols` indent columns.
function contentAfterIndent(line, cols) {
  return stripIndentCols(line, cols);
}

// ---- inline parsing ------------------------------------------------------

// The inline scanner works on one string (a paragraph's lines joined with
// \n, hard breaks marked by the sentinel char chosen in parse()). It emits
// HTML chunks into `out` and resolves emphasis / strikethrough with a
// delimiter stack that back-patches the opener chunks.

let HARD_BREAK = '\u0001';
// Sentinel prefix on a line: a setext-looking line that must be treated as
// plain text (a lazy setext underline inside a container). Chosen in
// parse() so neither sentinel occurs in the source.
let NOSETEXT = '\u0002';
// Whether the source ends with a newline (for the HTML-block trailing-newline rule).
let SRC_ENDS_NL = false;

function parseInline(text, refs, textOnly, noExtended) {
  const out = [];
  const delims = []; // {ch, len, canOpen, canClose, outIdx, tags}
  const n = text.length;
  let i = 0;
  let runStart = 0; // start of the current plain-text run

  const flushText = (end) => {
    if (end > runStart) {
      out.push(escapeTextRun(text.slice(runStart, end)));
    }
  };

  while (i < n) {
    const ch = text[i];
    const c = text.charCodeAt(i);

    // ---- hard break sentinel -------------------------------------------
    if (ch === HARD_BREAK) {
      flushText(i);
      if (!textOnly) out.push('<br>');
      i++;
      runStart = i;
      continue;
    }

    // ---- newline: soft break --------------------------------------------
    if (c === 10) {
      flushText(i);
      if (!textOnly) out.push('\n');
      i++;
      runStart = i;
      continue;
    }

    // ---- backslash escape / hard break ----------------------------------
    if (c === 92) {
      if (i + 1 < n) {
        const nc = text.charCodeAt(i + 1);
        if (nc === 10) {
          flushText(i);
          if (!textOnly) out.push('<br>');
          i += 2;
          runStart = i;
          continue;
        }
        if (isAsciiPunct(nc)) {
          flushText(i);
          out.push(escapeAll(text[i + 1]));
          i += 2;
          runStart = i;
          continue;
        }
      }
      i++;
      continue;
    }

    // ---- code span -------------------------------------------------------
    if (c === 96) {
      let j = i;
      while (j < n && text.charCodeAt(j) === 96) j++;
      const ticks = j - i;
      // find a matching run of exactly `ticks` backticks
      let k = j;
      let close = -1;
      while (k < n) {
        if (text.charCodeAt(k) === 96) {
          let m = k;
          while (m < n && text.charCodeAt(m) === 96) m++;
          if (m - k === ticks) {
            close = k;
            break;
          }
          k = m;
        } else {
          k++;
        }
      }
      if (close !== -1) {
        let content = text.slice(j, close);
        if (content.indexOf(HARD_BREAK) !== -1) content = content.split(HARD_BREAK).join(' ');
        content = content.replace(/\n/g, ' ');
        if (
          content.length >= 2 &&
          content.charCodeAt(0) === 32 &&
          content.charCodeAt(content.length - 1) === 32 &&
          !/^[ ]+$/.test(content)
        ) {
          content = content.slice(1, -1);
        }
        flushText(i);
        if (textOnly) {
          out.push(content);
        } else {
          out.push('<code>' + escapeAll(content) + '</code>');
        }
        i = close + ticks;
        runStart = i;
        continue;
      }
      i = j;
      continue;
    }

    // ---- emphasis / strikethrough delimiter runs -------------------------
    if (c === 42 || c === 95 || c === 126) {
      let j = i;
      while (j < n && text.charCodeAt(j) === c) j++;
      let len = j - i;
      if (c === 126 && len >= 3) {
        // runs of 3+ tildes are literal text
        i = j;
        continue;
      }
      const prev = i > 0 ? text.charCodeAt(i - 1) : 32;
      const next = j < n ? text.charCodeAt(j) : 32;
      const prevWs = isWhitespaceCode(prev);
      const nextWs = isWhitespaceCode(next);
      const prevPunct = isPunctCode(prev);
      const nextPunct = isPunctCode(next);
      const leftFlanking =
        !nextWs && (!nextPunct || prevWs || prevPunct);
      const rightFlanking =
        !prevWs && (!prevPunct || nextWs || nextPunct);
      let canOpen, canClose;
      if (c === 95) {
        canOpen = leftFlanking && (!rightFlanking || prevPunct);
        canClose = rightFlanking && (!leftFlanking || nextPunct);
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      flushText(i);
      const chunk = text.slice(i, j);
      out.push(chunk);
      if (canOpen || canClose) {
        delims.push({
          ch,
          len,
          canOpen,
          canClose,
          outIdx: out.length - 1,
          tags: '',
        });
        // try to close: walk the stack for a matching opener
        if (canClose) {
          processCloser(delims, out, textOnly);
        }
      }
      i = j;
      runStart = i;
      continue;
    }

    // ---- link / image ----------------------------------------------------
    if (c === 91 || (c === 33 && i + 1 < n && text.charCodeAt(i + 1) === 91)) {
      const isImage = c === 33;
      const openIdx = isImage ? i + 1 : i;
      const link = tryLink(text, openIdx, refs, textOnly, noExtended);
      if (link) {
        flushText(i);
        out.push(link.html);
        i = link.end;
        runStart = i;
        continue;
      }
      i += isImage ? 1 : 1;
      continue;
    }

    // ---- autolink / inline HTML ------------------------------------------
    if (c === 60) {
      const tag = tryAngle(text, i, refs, textOnly);
      if (tag) {
        flushText(i);
        out.push(tag.html);
        i = tag.end;
        runStart = i;
        continue;
      }
      i++;
      continue;
    }

    // ---- entity -----------------------------------------------------------
    if (c === 38) {
      const ent = tryEntity(text, i);
      if (ent) {
        flushText(i);
        out.push(ent.html);
        i = ent.end;
        runStart = i;
        continue;
      }
      i++;
      continue;
    }

    // ---- GFM extended autolinks ------------------------------------------
    if (!textOnly && !noExtended) {
      const ext = tryExtendedAutolink(text, i);
      if (ext) {
        flushText(i);
        out.push(ext.html);
        i = ext.end;
        runStart = i;
        continue;
      }
    }

    i++;
  }
  flushText(n);
  // Any delimiters left unmatched stay literal (already emitted as text).
  return out.join('');
}

// Escape a plain-text run: < > " ' (and & — the scanner splits at & so a run
// never contains one, but escape it anyway for safety).
function escapeTextRun(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const r = ESCAPE_MAP[s.charCodeAt(i)];
    if (r !== undefined) {
      if (i > start) out += s.slice(start, i);
      out += r;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

// Resolve emphasis for the closer just pushed on the delimiter stack. The
// closer is delims[delims.length - 1]; it looks back for the nearest opener
// of the same character and converts delimiter runs into tags by patching
// the opener's emitted chunk (literal remainder + open tags) and its own
// chunk (close tags + literal remainder).
function processCloser(delims, out, textOnly) {
  const closer = delims[delims.length - 1];
  if (!closer.canClose) return;
  const ch = closer.ch;
  // find nearest matching opener below the closer
  let oi = -1;
  for (let k = delims.length - 2; k >= 0; k--) {
    const d = delims[k];
    if (d.ch !== ch || !d.canOpen) continue;
    // odd-match rule: when one of the two can both open and close and the
    // lengths sum to a multiple of 3, they may not match (unless both
    // lengths are multiples of 3)
    const bothCapable = (d.canOpen && d.canClose) || (closer.canOpen && closer.canClose);
    if (
      bothCapable &&
      (d.len + closer.len) % 3 === 0 &&
      !(d.len % 3 === 0 && closer.len % 3 === 0)
    ) {
      continue;
    }
    oi = k;
    break;
  }
  if (oi === -1) {
    // no match: if the closer can also open, it stays on the stack as a
    // potential opener for a later closer; otherwise it is just literal
    if (!closer.canOpen) delims.pop();
    return;
  }
  const opener = delims[oi];
  const use = opener.len >= 2 && closer.len >= 2 ? 2 : 1;
  const isDel = ch === '~';
  const openTag = textOnly
    ? ''
    : use === 2
      ? isDel
        ? '<del>'
        : '<strong>'
      : isDel
        ? '<del>'
        : '<em>';
  const closeTag = textOnly
    ? ''
    : use === 2
      ? isDel
        ? '</del>'
        : '</strong>'
      : isDel
        ? '</del>'
        : '</em>';
  // patch the opener chunk: keep its unused literal delimiters, then the tags.
  // A later match wraps a larger span, so its open tag goes BEFORE the
  // tags already earned (it is the outer tag).
  opener.len -= use;
  opener.tags = openTag + opener.tags;
  out[opener.outIdx] =
    ch.repeat(opener.len) + opener.tags;
  if (opener.len === 0) delims.splice(oi, 1);
  // patch the closer chunk: the close tags, then the unused remainder
  closer.len -= use;
  closer.tags += closeTag;
  out[closer.outIdx] =
    closer.tags + ch.repeat(closer.len);
  if (closer.len === 0) {
    delims.pop();
    return;
  }
  // the remainder may close an earlier opener; keep looking
  processCloser(delims, out, textOnly);
}

// Try to parse an entity reference at `i` (text[i] === '&').
// Numeric references decode to a character (invalid -> U+FFFD); named ones
// are passed through unchanged; anything else is not an entity.
function tryEntity(text, i) {
  const n = text.length;
  let j = i + 1;
  if (j < n && text.charCodeAt(j) === 35) {
    j++;
    if (j < n && (text.charCodeAt(j) === 120 || text.charCodeAt(j) === 88)) {
      j++;
      const h0 = j;
      let code = 0;
      while (j < n && isHexCode(text.charCodeAt(j))) {
        code = code * 16 + parseInt(text[j], 16);
        j++;
      }
      if (j - h0 > 6) return null;
      if (j > h0 && j < n && text.charCodeAt(j) === 59) {
        return { html: escapeAll(decodeNumeric(code)), end: j + 1 };
      }
      return null;
    }
    const d0 = j;
    let code = 0;
    while (j < n && isDigitCode(text.charCodeAt(j))) {
      code = code * 10 + (text.charCodeAt(j) - 48);
      j++;
    }
    if (j - d0 > 7) return null;
    if (j > d0 && j < n && text.charCodeAt(j) === 59) {
      return { html: escapeAll(decodeNumeric(code)), end: j + 1 };
    }
    return null;
  }
  const w0 = j;
  while (j < n && isWordCode(text.charCodeAt(j))) j++;
  if (j > w0 && j < n && text.charCodeAt(j) === 59) {
    return { html: text.slice(i, j + 1), end: j + 1 };
  }
  return null;
}

// ---- links and images ----------------------------------------------------

// Find the index of the `]` matching the `[` at `openIdx` (depth-aware,
// code-span-aware, backslash-aware). Returns -1 when there is none.
function findClosingBracket(text, openIdx) {
  const n = text.length;
  let depth = 1;
  let i = openIdx + 1;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 92) {
      i += 2;
      continue;
    }
    if (c === 96) {
      let j = i;
      while (j < n && text.charCodeAt(j) === 96) j++;
      const ticks = j - i;
      let k = j;
      let close = -1;
      while (k < n) {
        if (text.charCodeAt(k) === 96) {
          let m = k;
          while (m < n && text.charCodeAt(m) === 96) m++;
          if (m - k === ticks) {
            close = k;
            break;
          }
          k = m;
        } else k++;
      }
      if (close === -1) return -1;
      i = close + ticks;
      continue;
    }
    if (c === 91) depth++;
    else if (c === 93) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Normalize a link label for reference lookup: collapse whitespace runs to
// one space, trim, and lowercase.
function normalizeLabel(label) {
  let out = '';
  let inWs = true; // trims leading whitespace
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      if (!inWs) {
        out += ' ';
        inWs = true;
      }
    } else {
      out += label[i].toLowerCase();
      inWs = false;
    }
  }
  if (out.charCodeAt(out.length - 1) === 32) out = out.slice(0, -1);
  return out;
}

// Skip spaces, tabs and newlines starting at `i`. Returns the new index.
function skipInlineWs(text, i) {
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10) i++;
    else break;
  }
  return i;
}

// Parse a link destination starting at `i` (after `(` and whitespace).
// Returns {dest, end} (end = index after the destination) or null.
function parseLinkDest(text, i) {
  const n = text.length;
  if (i >= n) return null;
  if (text.charCodeAt(i) === 60) {
    // <...> destination: no line endings, no unescaped < or > inside
    let j = i + 1;
    let dest = '';
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === 10) return null;
      if (c === 62) return { dest, end: j + 1 };
      if (c === 60) return null;
      if (c === 92 && j + 1 < n && isAsciiPunct(text.charCodeAt(j + 1))) {
        dest += text[j + 1];
        j += 2;
        continue;
      }
      dest += text[j];
      j++;
    }
    return null;
  }
  // bare destination: no spaces or control chars, balanced parens
  let j = i;
  let dest = '';
  let depth = 0;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (c === 32 || c === 9 || c === 10 || c < 32) break;
    if (c === 92 && j + 1 < n && isAsciiPunct(text.charCodeAt(j + 1))) {
      dest += text[j + 1];
      j += 2;
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41) {
      if (depth === 0) break;
      depth--;
    }
    dest += text[j];
    j++;
  }
  if (depth !== 0) return null;
  return { dest, end: j };
}

// Parse a link title starting at `i` (quote char ", ' or (). Returns
// {title, end} or null.
function parseLinkTitle(text, i) {
  const n = text.length;
  const q = text.charCodeAt(i);
  const close = q === 40 ? 41 : q;
  let j = i + 1;
  let title = '';
  while (j < n) {
    const c = text.charCodeAt(j);
    if (c === close) return { title, end: j + 1 };
    if (q === 40 && c === 40) return null;
    if (c === 92 && j + 1 < n && isAsciiPunct(text.charCodeAt(j + 1))) {
      title += text[j + 1];
      j += 2;
      continue;
    }
    title += text[j];
    j++;
  }
  return null;
}

// Try to parse a link or image whose `[` is at `openIdx`. `isImage` says
// whether a `!` precedes it. Returns {html, end} or null. In textOnly mode
// the result is the link's plain text (or the image's alt text).
function tryLink(text, openIdx, refs, textOnly, noExtended) {
  const closeIdx = findClosingBracket(text, openIdx);
  if (closeIdx === -1) return null;
  const label = text.slice(openIdx + 1, closeIdx);
  let i = closeIdx + 1;
  const n = text.length;
  let dest = null;
  let title = null;

  if (i < n && text.charCodeAt(i) === 40) {
    // inline link: (dest "title")
    let j = skipInlineWs(text, i + 1);
    if (j < n && text.charCodeAt(j) === 41) {
      dest = '';
      i = j + 1;
    } else {
      const d = parseLinkDest(text, j);
      if (!d) return null;
      dest = d.dest;
      j = skipInlineWs(text, d.end);
      if (
        j < n &&
        (text.charCodeAt(j) === 34 ||
          text.charCodeAt(j) === 39 ||
          text.charCodeAt(j) === 40)
      ) {
        const t = parseLinkTitle(text, j);
        if (!t) return null;
        title = t.title;
        j = skipInlineWs(text, t.end);
      }
      if (j >= n || text.charCodeAt(j) !== 41) return null;
      i = j + 1;
    }
  } else if (i < n && text.charCodeAt(i) === 91) {
    // full or collapsed reference: [label] or []
    const refClose = findClosingBracket(text, i);
    if (refClose === -1) return null;
    const refLabel = refClose === i + 1 ? label : text.slice(i + 1, refClose);
    const ref = refs[normalizeLabel(refLabel)];
    if (!ref) return null;
    dest = ref.dest;
    title = ref.title;
    i = refClose + 1;
  } else {
    // shortcut reference
    const ref = refs[normalizeLabel(label)];
    if (!ref) return null;
    dest = ref.dest;
    title = ref.title;
    i = closeIdx + 1;
  }

  const isImage = openIdx > 0 && text.charCodeAt(openIdx - 1) === 33;
  if (isImage) {
    const alt = parseInline(label, refs, true, true);
    if (textOnly) return { html: alt, end: i };
    const src = cleanHref(dest);
    let html = '<img src="' + src + '" alt="' + escapeAttr(alt) + '"';
    if (title != null) html += ' title="' + escapeAttr(title) + '"';
    return { html: html + '>', end: i };
  }
  const inner = parseInline(label, refs, textOnly, true);
  if (textOnly) return { html: inner, end: i };
  const href = cleanHref(dest);
  let html = '<a href="' + href + '"';
  if (title != null) html += ' title="' + escapeAttr(title) + '"';
  return { html: html + '>' + inner + '</a>', end: i };
}

// ---- angle autolinks and inline HTML -------------------------------------

// The block-level tag names of CommonMark HTML block type 6.
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section',
  'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
]);

// Try to parse an HTML tag starting at `i` (text[i] === '<'). Returns
// {end} (end = index after the tag) or null when the text is not a tag.
// Every attribute must be preceded by whitespace; a closing tag takes no
// attributes (only whitespace, then >).
function parseHtmlTag(text, i) {
  const n = text.length;
  let j = i + 1;
  let closing = false;
  if (j < n && text.charCodeAt(j) === 47) { closing = true; j++; }
  if (j >= n || !isAlphaCode(text.charCodeAt(j))) return null;
  while (j < n && (isAlnumCode(text.charCodeAt(j)) || text.charCodeAt(j) === 45)) j++;
  if (closing) {
    while (j < n && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 || text.charCodeAt(j) === 10)) j++;
    if (j < n && text.charCodeAt(j) === 62) return { end: j + 1 };
    return null;
  }
  // attributes
  while (j < n) {
    const c = text.charCodeAt(j);
    if (c === 62) return { end: j + 1 };
    if (c === 47) {
      j++;
      if (j < n && text.charCodeAt(j) === 62) return { end: j + 1 };
      return null;
    }
    if (c !== 32 && c !== 9 && c !== 10) return null;
    while (j < n && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 || text.charCodeAt(j) === 10)) j++;
    if (j >= n) return null;
    const c2 = text.charCodeAt(j);
    if (c2 === 62) return { end: j + 1 };
    if (c2 === 47) {
      j++;
      if (j < n && text.charCodeAt(j) === 62) return { end: j + 1 };
      return null;
    }
    // attribute name
    if (
      !isAlphaCode(c2) &&
      c2 !== 95 &&
      c2 !== 58 &&
      !(c2 >= 128)
    ) {
      return null;
    }
    while (
      j < n &&
      (isAlnumCode(text.charCodeAt(j)) ||
        text.charCodeAt(j) === 95 ||
        text.charCodeAt(j) === 58 ||
        text.charCodeAt(j) === 46 ||
        text.charCodeAt(j) === 45 ||
        text.charCodeAt(j) >= 128)
    ) {
      j++;
    }
    while (j < n && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 || text.charCodeAt(j) === 10)) j++;
    if (j < n && text.charCodeAt(j) === 61) {
      j++;
      while (j < n && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 || text.charCodeAt(j) === 10)) j++;
      if (j >= n) return null;
      const qc = text.charCodeAt(j);
      if (qc === 34 || qc === 39) {
        j++;
        while (j < n && text.charCodeAt(j) !== qc) j++;
        if (j >= n) return null;
        j++;
      } else {
        if (
          text.charCodeAt(j) === 34 ||
          text.charCodeAt(j) === 39 ||
          text.charCodeAt(j) === 61 ||
          text.charCodeAt(j) === 60 ||
          text.charCodeAt(j) === 62 ||
          text.charCodeAt(j) === 96
        ) {
          return null;
        }
        while (
          j < n &&
          !isSpaceCode(text.charCodeAt(j)) &&
          text.charCodeAt(j) !== 62
        ) {
          j++;
        }
      }
    }
  }
  return null;
}

// Try an autolink `<scheme:...>` / `<email>` or an inline HTML construct at
// `i` (text[i] === '<'). Returns {html, end} or null.
function tryAngle(text, i, refs, textOnly) {
  const n = text.length;
  // comment
  if (text.startsWith('<!--', i)) {
    // abrupt-closing empty comments: <!--> and <!---> end at the first >
    if (text.startsWith('<!-->', i)) {
      if (textOnly) return { html: '', end: i + 5 };
      return { html: text.slice(i, i + 5), end: i + 5 };
    }
    if (text.startsWith('<!--->', i)) {
      if (textOnly) return { html: '', end: i + 6 };
      return { html: text.slice(i, i + 6), end: i + 6 };
    }
    const end = text.indexOf('-->', i + 4);
    if (end !== -1) {
      if (textOnly) return { html: '', end: end + 3 };
      return { html: text.slice(i, end + 3), end: end + 3 };
    }
    return null;
  }
  // processing instruction
  if (text.startsWith('<?', i)) {
    const end = text.indexOf('?>', i + 2);
    if (end !== -1) {
      if (textOnly) return { html: '', end: end + 2 };
      return { html: text.slice(i, end + 2), end: end + 2 };
    }
    return null;
  }
  // declaration <!A ...>
  if (text.startsWith('<!', i) && i + 2 < n && isAlphaCode(text.charCodeAt(i + 2))) {
    const end = text.indexOf('>', i + 2);
    if (end !== -1) {
      if (textOnly) return { html: '', end: end + 1 };
      return { html: text.slice(i, end + 1), end: end + 1 };
    }
    return null;
  }
  // CDATA
  if (text.startsWith('<![CDATA[', i)) {
    const end = text.indexOf(']]>', i + 9);
    if (end !== -1) {
      if (textOnly) return { html: '', end: end + 3 };
      return { html: text.slice(i, end + 3), end: end + 3 };
    }
    return null;
  }
  // autolink: <...> with no space or < inside, ending at >. If a space or
  // < appears first it is not an autolink — but it may still be an HTML tag.
  let j = i + 1;
  let hasClose = false;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (c === 62) { hasClose = true; break; }
    if (c === 32 || c === 10 || c === 60) break;
    j++;
  }
  if (hasClose) {
  const inner = text.slice(i + 1, j);
  // scheme autolink: 2-32 chars, letter first, then letters/digits/+/-/.
  const colon = inner.indexOf(':');
  if (colon >= 1 && colon <= 32 && isAlphaCode(inner.charCodeAt(0))) {
    let ok = true;
    for (let k = 1; k < colon; k++) {
      const c = inner.charCodeAt(k);
      if (
        !isAlnumCode(c) &&
        c !== 43 &&
        c !== 45 &&
        c !== 46
      ) {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (textOnly) return { html: escapeAll(inner), end: j + 1 };
      const href = cleanAutolinkHref(inner);
      return {
        html: '<a href="' + href + '">' + escapeAll(inner) + '</a>',
        end: j + 1,
      };
    }
  }
  // email autolink
  if (inner.indexOf('@') !== -1 && isEmail(inner)) {
    if (textOnly) return { html: escapeAll(inner), end: j + 1 };
    return {
      html:
        '<a href="mailto:' +
        escapeAll(inner) +
        '">' +
        escapeAll(inner) +
        '</a>',
      end: j + 1,
    };
  }
  } // end if (hasClose)
  // otherwise an HTML tag (open or close), if it parses as one
  const tag = parseHtmlTag(text, i);
  if (!tag) return null;
  if (textOnly) return { html: '', end: tag.end };
  return { html: text.slice(i, tag.end), end: tag.end };
}

// An autolink URL goes through encodeURI and then a plain (non
// entity-aware) escape: every & becomes &amp;.
function cleanAutolinkHref(url) {
  let enc;
  try {
    enc = encodeURI(url);
  } catch {
    enc = url;
  }
  return escapeAll(enc);
}

// ---- GFM extended autolinks ----------------------------------------------

// Scan a URL tail starting at `start`: consume until whitespace or '<'.
// Stops before a '(' when no ')' follows it in the same run.
function scanUrlTail(text, start) {
  const n = text.length;
  let runEnd = start;
  while (runEnd < n) {
    const c = text.charCodeAt(runEnd);
    if (c === 32 || c === 9 || c === 10 || c === 60) break;
    runEnd++;
  }
  let j = start;
  while (j < runEnd) {
    if (text.charCodeAt(j) === 40) {
      if (text.indexOf(')', j + 1) >= runEnd || text.indexOf(')', j + 1) === -1) break;
    }
    j++;
  }
  return j;
}

// Trim a matched autolink URL: drop a trailing entity reference, drop
// trailing ')'s while the parens are unbalanced (or the URL ends with '))'),
// and drop trailing punctuation ? ! . , : ; * _ ~. Repeats until stable.
function trimUrlTail(url) {
  let end = url.length;
  let changed = true;
  while (changed && end > 0) {
    changed = false;
    // trailing entity reference &name; / &#123; / &#x1f;
    if (url.charCodeAt(end - 1) === 59) {
      const amp = url.lastIndexOf('&', end - 2);
      if (amp !== -1) {
        const body = url.slice(amp + 1, end - 1);
        if (/^(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z0-9]+)$/.test(body)) {
          end = amp;
          changed = true;
          continue;
        }
      }
    }
    // trailing ')'
    if (url.charCodeAt(end - 1) === 41) {
      let depth = 0;
      for (let k = 0; k < end; k++) {
        if (url.charCodeAt(k) === 40) depth++;
        else if (url.charCodeAt(k) === 41) depth--;
      }
      if (depth < 0 || (end >= 2 && url.charCodeAt(end - 2) === 41)) {
        end--;
        changed = true;
        continue;
      }
    }
    // trailing punctuation
    const last = url.charCodeAt(end - 1);
    if (
      last === 63 ||
      last === 33 ||
      last === 46 ||
      last === 44 ||
      last === 58 ||
      last === 59 ||
      last === 42 ||
      last === 95 ||
      last === 126
    ) {
      end--;
      changed = true;
    }
  }
  return url.slice(0, end);
}

// A www domain label: first char alnum or '-', rest word chars or '-'.
function scanWwwLabel(text, j) {
  const n = text.length;
  const c0 = text.charCodeAt(j);
  if (!isAlnumCode(c0) && c0 !== 45) return -1;
  j++;
  while (
    j < n &&
    (isWordCode(text.charCodeAt(j)) || text.charCodeAt(j) === 45)
  ) {
    j++;
  }
  return j;
}

function tryWww(text, i) {
  const n = text.length;
  let j = i + 4;
  let labels = 0;
  while (true) {
    const after = scanWwwLabel(text, j);
    if (after === -1) return null;
    j = after;
    labels++;
    if (j < n && text.charCodeAt(j) === 46) {
      if (j + 1 < n) {
        const c1 = text.charCodeAt(j + 1);
        if (isAlnumCode(c1) || c1 === 45) {
          j++;
          continue;
        }
      }
      break;
    }
    break;
  }
  if (labels === 0) return null;
  // optional :port
  if (j < n && text.charCodeAt(j) === 58) {
    let k = j + 1;
    if (k < n && isDigitCode(text.charCodeAt(k))) {
      while (k < n && isDigitCode(text.charCodeAt(k))) k++;
      j = k;
    }
  }
  // optional path / query / fragment
  if (
    j < n &&
    (text.charCodeAt(j) === 47 ||
      text.charCodeAt(j) === 63 ||
      text.charCodeAt(j) === 35)
  ) {
    j = scanUrlTail(text, j);
  }
  let url = trimUrlTail(text.slice(i, j));
  if (url.length <= 4) return null;
  const href = cleanAutolinkHref('http://' + url);
  return {
    html: '<a href="' + href + '">' + escapeAll(url) + '</a>',
    end: i + url.length,
  };
}

function tryScheme(text, i) {
  const n = text.length;
  let len = 0;
  const c0 = text.charCodeAt(i) | 32;
  if (c0 === 104) {
    // http:// or https://
    if (
      i + 7 <= n &&
      (text.charCodeAt(i + 1) | 32) === 116 &&
      (text.charCodeAt(i + 2) | 32) === 116 &&
      (text.charCodeAt(i + 3) | 32) === 112 &&
      text.charCodeAt(i + 4) === 58 &&
      text.charCodeAt(i + 5) === 47 &&
      text.charCodeAt(i + 6) === 47
    ) {
      len = 7;
    } else if (
      i + 8 <= n &&
      (text.charCodeAt(i + 1) | 32) === 116 &&
      (text.charCodeAt(i + 2) | 32) === 116 &&
      (text.charCodeAt(i + 3) | 32) === 112 &&
      (text.charCodeAt(i + 4) | 32) === 115 &&
      text.charCodeAt(i + 5) === 58 &&
      text.charCodeAt(i + 6) === 47 &&
      text.charCodeAt(i + 7) === 47
    ) {
      len = 8;
    }
  } else if (c0 === 102) {
    // ftp://
    if (
      i + 6 <= n &&
      (text.charCodeAt(i + 1) | 32) === 116 &&
      (text.charCodeAt(i + 2) | 32) === 112 &&
      text.charCodeAt(i + 3) === 58 &&
      text.charCodeAt(i + 4) === 47 &&
      text.charCodeAt(i + 5) === 47
    ) {
      len = 6;
    }
  }
  if (len === 0) return null;
  const j = scanUrlTail(text, i + len);
  if (j === i + len) return null;
  const url = trimUrlTail(text.slice(i, j));
  if (url.length <= len) return null;
  const href = cleanAutolinkHref(url);
  return {
    html: '<a href="' + href + '">' + escapeAll(url) + '</a>',
    end: i + url.length,
  };
}

// Email local-part characters (atext plus '.').
function isEmailLocalChar(c) {
  return (
    isAlnumCode(c) ||
    c === 33 ||
    c === 35 ||
    c === 36 ||
    c === 37 ||
    c === 38 ||
    c === 39 ||
    c === 42 ||
    c === 43 ||
    c === 45 ||
    c === 46 ||
    c === 47 ||
    c === 61 ||
    c === 63 ||
    c === 94 ||
    c === 95 ||
    c === 96 ||
    c === 123 ||
    c === 124 ||
    c === 125 ||
    c === 126
  );
}

// A domain label run: word chars and '-' (at least one char).
function scanDomainLabel(text, j) {
  const n = text.length;
  const start = j;
  while (
    j < n &&
    (isWordCode(text.charCodeAt(j)) || text.charCodeAt(j) === 45)
  ) {
    j++;
  }
  return j === start ? -1 : j;
}

// Is `s` an email address (used for <...> autolinks)?
function isEmail(s) {
  const at = s.indexOf('@');
  if (at <= 0) return false;
  for (let k = 0; k < at; k++) {
    if (!isEmailLocalChar(s.charCodeAt(k))) return false;
  }
  return scanEmailDomain(s, at + 1) === s.length;
}

// Scan an email domain starting at `j` in `s`; returns the end index or -1.
// Domain: optional leading '.', labels of [\w-]+ separated by single dots,
// at least two labels, the last ending in an alphanumeric, and the next
// character after the domain must not be a word char or '-'.
function scanEmailDomain(s, j) {
  const n = s.length;
  if (j < n && s.charCodeAt(j) === 46) j++; // leading dot allowed
  let labels = 0;
  let end = j;
  while (true) {
    const after = scanDomainLabel(s, end);
    if (after === -1) return -1;
    end = after;
    labels++;
    if (end < n && s.charCodeAt(end) === 46) {
      if (end + 1 < n) {
        const c1 = s.charCodeAt(end + 1);
        if (isWordCode(c1) || c1 === 45) {
          end++;
          continue;
        }
      }
      break;
    }
    break;
  }
  if (labels < 2) return -1;
  // the last label must end in an alphanumeric; strip trailing -/_
  let e = end;
  while (e > j) {
    const c = s.charCodeAt(e - 1);
    if (c === 45 || c === 95) e--;
    else break;
  }
  if (e === j || !isAlnumCode(s.charCodeAt(e - 1))) return -1;
  // lookahead: the next character must not be a word char or '-'
  if (e < n) {
    const c = s.charCodeAt(e);
    if (isWordCode(c) || c === 45) return -1;
  }
  return e;
}

function tryEmail(text, i) {
  const n = text.length;
  // local part from i
  let j = i;
  while (j < n && isEmailLocalChar(text.charCodeAt(j))) j++;
  if (j === i || j >= n || text.charCodeAt(j) !== 64) return null;
  const domEnd = scanEmailDomain(text, j + 1);
  if (domEnd === -1) return null;
  let start = i;
  let email = text.slice(i, domEnd);
  // a directly preceding lowercase 'mailto:' (not preceded by a word char)
  // is part of the link
  if (i >= 7 && text.slice(i - 7, i) === 'mailto:') {
    if (i - 7 === 0 || !isWordCode(text.charCodeAt(i - 8))) {
      start = i - 7;
      email = 'mailto:' + email;
    }
  }
  const href = 'mailto:' + text.slice(i, domEnd);
  return {
    html:
      '<a href="' +
      escapeAll(href) +
      '">' +
      escapeAll(email) +
      '</a>',
    end: domEnd,
  };
}

// Try a GFM extended autolink at position `i` (www., scheme://, or email).
// Returns {html, end} or null.
function tryExtendedAutolink(text, i) {
  const c = text.charCodeAt(i);
  // www.
  if (
    (c === 119 || c === 87) &&
    text.startsWith('www.', i) &&
    (i === 0 ||
      isWhitespaceCode(text.charCodeAt(i - 1)) ||
      text.charCodeAt(i - 1) === 40 ||
      text.charCodeAt(i - 1) === 42 ||
      text.charCodeAt(i - 1) === 95 ||
      text.charCodeAt(i - 1) === 126)
  ) {
    // 'www.' must be lowercase
    if (c === 119) {
      const w = tryWww(text, i);
      if (w) return w;
    }
  }
  // scheme://
  if (c === 104 || c === 72 || c === 102 || c === 70) {
    const s = tryScheme(text, i);
    if (s) return s;
  }
  // email: only at the start of a local-part run
  if (
    isEmailLocalChar(c) &&
    (i === 0 || !isEmailLocalChar(text.charCodeAt(i - 1)))
  ) {
    return tryEmail(text, i);
  }
  return null;
}

// ---- block parsing --------------------------------------------------------

// Remove `cols` columns from the front of `line`, where the front starts
// with a container marker ending at string index `markerEndIdx` (0 when
// there is no marker, e.g. a list item's continuation line). Tabs in the
// whitespace following the marker are expanded to spaces by column, so a
// tab that starts at or after the strip boundary still expands; tabs after
// the first non-whitespace character are preserved verbatim. A tab that
// straddles the boundary contributes spaces for its remaining columns.
function stripContainerCols(line, markerEndIdx, cols) {
  // column of markerEndIdx (the marker part holds no tabs in practice)
  let col = markerEndIdx;
  // find first non-whitespace index at or after markerEndIdx
  let nw = markerEndIdx;
  while (nw < line.length) {
    const c = line.charCodeAt(nw);
    if (c === 32 || c === 9) nw++;
    else break;
  }
  // expand the whitespace run [markerEndIdx, nw) to spaces by column
  let expanded = '';
  let c2 = col;
  for (let k = markerEndIdx; k < nw; k++) {
    const ch = line.charCodeAt(k);
    if (ch === 32) {
      expanded += ' ';
      c2++;
    } else {
      const w = 4 - (c2 % 4);
      expanded += ' '.repeat(w);
      c2 += w;
    }
  }
  const rebuilt = line.slice(0, markerEndIdx) + expanded + line.slice(nw);
  return rebuilt.slice(cols);
}

// Strip the NOSETEXT sentinel prefix from a line, if present.
function stripSentinel(line) {
  return line.charCodeAt(0) === NOSETEXT.charCodeAt(0)
    ? line.slice(1)
    : line;
}

// Is this line a setext underline (a run of = or - with up to 3 spaces of
// indent and only spaces/tabs after)? A NOSETEXT line never is.
function isSetextLine(line) {
  if (line.charCodeAt(0) === NOSETEXT.charCodeAt(0)) return false;
  const ind = indentOf(line);
  if (ind.col > 3) return false;
  let i = ind.idx;
  const c = line.charCodeAt(i);
  if (c !== 61 && c !== 45) return false; // = or -
  while (i < line.length && line.charCodeAt(i) === c) i++;
  while (i < line.length) {
    const d = line.charCodeAt(i);
    if (d !== 32 && d !== 9) return false;
    i++;
  }
  return i > ind.idx;
}

// Is this line an =-run setext underline?
function isEqualsRun(line) {
  if (line.charCodeAt(0) === NOSETEXT.charCodeAt(0)) return false;
  const ind = indentOf(line);
  if (ind.col > 3) return false;
  let i = ind.idx;
  if (line.charCodeAt(i) !== 61) return false;
  while (i < line.length && line.charCodeAt(i) === 61) i++;
  while (i < line.length) {
    const d = line.charCodeAt(i);
    if (d !== 32 && d !== 9) return false;
    i++;
  }
  return i > ind.idx;
}

// Is this line a thematic break (3+ of -, * or _ with optional spaces
// between, up to 3 spaces of indent)?
function isHrLine(line) {
  const ind = indentOf(line);
  if (ind.col > 3) return false;
  let i = ind.idx;
  if (i >= line.length) return false;
  const c = line.charCodeAt(i);
  if (c !== 45 && c !== 42 && c !== 95) return false; // - * _
  let count = 0;
  while (i < line.length) {
    const d = line.charCodeAt(i);
    if (d === c) {
      count++;
      i++;
    } else if (d === 32 || d === 9) {
      i++;
    } else return false;
  }
  return count >= 3;
}

// Parse an ATX heading line. Returns {level, text} or null.
function parseAtx(line) {
  const ind = indentOf(line);
  if (ind.col > 3) return null;
  let i = ind.idx;
  let level = 0;
  while (i < line.length && line.charCodeAt(i) === 35 && level < 6) {
    level++;
    i++;
  }
  if (level === 0) return null;
  if (i < line.length && line.charCodeAt(i) === 35) return null; // 7+ #
  if (
    i < line.length &&
    line.charCodeAt(i) !== 32 &&
    line.charCodeAt(i) !== 9
  ) {
    return null; // needs a space/tab or end of line after the hashes
  }
  while (
    i < line.length &&
    (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)
  ) {
    i++;
  }
  let content = line.slice(i).replace(/[ \t]+$/, '');
  if (/^#+$/.test(content)) {
    content = '';
  } else {
    const m = /[ \t]+#+$/.exec(content);
    if (m) content = content.slice(0, m.index).replace(/[ \t]+$/, '');
  }
  return { level, text: content };
}

// Parse a fenced code block start. Returns {fenceChar, len, info} or null.
// A backtick fence's info string may not contain a backtick.
function parseFenceStart(line) {
  const ind = indentOf(line);
  if (ind.col > 3) return null;
  const i = ind.idx;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  if (c !== 96 && c !== 126) return null; // ` or ~
  let j = i;
  while (j < line.length && line.charCodeAt(j) === c) j++;
  const len = j - i;
  if (len < 3) return null;
  const info = line.slice(j);
  if (c === 96 && info.indexOf('`') !== -1) return null;
  return { fenceChar: c, len, info };
}

// Is this line a closing fence for a fence of `fenceChar` opened with `len`?
function isFenceClose(line, fenceChar, len) {
  const ind = indentOf(line);
  if (ind.col > 3) return false;
  let i = ind.idx;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === fenceChar) j++;
  if (j - i < len) return false;
  for (let k = j; k < line.length; k++) {
    const d = line.charCodeAt(k);
    if (d !== 32 && d !== 9) return false;
  }
  return true;
}

// Parse an HTML block start. Returns {type, tag?, endMarker?, searchFrom?}
// or null. Types 1-2 end at a closing marker line; 6-7 end at a blank line
// (6 also ends at the line holding its matching close tag).
function parseHtmlBlockStart(line) {
  const ind = indentOf(line);
  if (ind.col > 3) return null;
  const s = line.slice(ind.idx);
  if (s.charCodeAt(0) !== 60) return null; // <
  const m1 = /^<(script|pre|style|textarea)(?=[ \t>\/]|$)/i.exec(s);
  if (m1) return { type: 1, tag: m1[1].toLowerCase() };
  if (s.startsWith('<!--')) return { type: 2, endMarker: '-->', searchFrom: 4 };
  if (s.startsWith('<?')) return { type: 2, endMarker: '?>', searchFrom: 2 };
  if (s.startsWith('<![CDATA[')) {
    return { type: 2, endMarker: ']]>', searchFrom: 9 };
  }
  if (/^<![A-Za-z]/.test(s)) return { type: 2, endMarker: '>', searchFrom: 2 };
  const m6 = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[ \t>\/]|$)/.exec(s);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) {
    return { type: 6, tag: m6[1].toLowerCase() };
  }
  // type 7: a complete open or close tag alone on the line
  const tag = parseHtmlTag(s, 0);
  if (tag) {
    let rest = s.slice(tag.end);
    let onlyWs = true;
    for (let k = 0; k < rest.length; k++) {
      const d = rest.charCodeAt(k);
      if (d !== 32 && d !== 9) {
        onlyWs = false;
        break;
      }
    }
    if (onlyWs) return { type: 7 };
  }
  return null;
}

// Parse a list marker at the start of `line`. Returns null when the line is
// not a marker, else {kind, bullet, num, delim, indent, markerEndIdx,
// markerEndCol, contentIndent, empty, firstContent}.
function parseMarker(line) {
  const ind = indentOf(line);
  if (ind.col > 3) return null;
  let i = ind.idx;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  let kind = null;
  let bullet = null;
  let num = 0;
  let delim = null;
  let markerEndIdx;
  if (c === 45 || c === 43 || c === 42) {
    // - + *
    kind = 'bullet';
    bullet = line[i];
    markerEndIdx = i + 1;
  } else if (c >= 48 && c <= 57) {
    // ordered: 1-9 digits + . or )
    let j = i;
    while (j < line.length && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
    const digits = j - i;
    if (digits === 0 || digits > 9) return null;
    if (j >= line.length) return null;
    const d = line.charCodeAt(j);
    if (d !== 46 && d !== 41) return null; // . or )
    kind = 'ordered';
    num = parseInt(line.slice(i, j), 10);
    delim = line[j];
    markerEndIdx = j + 1;
  } else {
    return null;
  }
  // the marker must be followed by a space/tab or end of line
  if (
    markerEndIdx < line.length &&
    line.charCodeAt(markerEndIdx) !== 32 &&
    line.charCodeAt(markerEndIdx) !== 9
  ) {
    return null;
  }
  const markerEndCol = ind.col + (markerEndIdx - ind.idx);
  // whitespace after the marker, in columns
  let col = markerEndCol;
  let k = markerEndIdx;
  let wsCols = 0;
  while (k < line.length) {
    const d = line.charCodeAt(k);
    if (d === 32) {
      wsCols++;
      col++;
      k++;
    } else if (d === 9) {
      const w = 4 - (col % 4);
      wsCols += w;
      col += w;
      k++;
    } else break;
  }
  const empty = k >= line.length;
  let contentIndent;
  if (empty) {
    contentIndent = markerEndCol + 1;
  } else if (wsCols >= 1 && wsCols <= 4) {
    contentIndent = markerEndCol + wsCols;
  } else {
    contentIndent = markerEndCol + 1;
  }
  const firstContent = empty
    ? ''
    : stripContainerCols(line, markerEndIdx, contentIndent);
  return {
    kind,
    bullet,
    num,
    delim,
    indent: ind.col,
    markerEndIdx,
    markerEndCol,
    contentIndent,
    empty,
    firstContent,
  };
}

// Split a table row on unescaped pipes; trim each cell; drop a leading and
// a trailing empty cell (from outer pipes).
function splitTableRow(line) {
  const cells = [];
  let cur = '';
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '\\' && k + 1 < line.length) {
      const nx = line[k + 1];
      if (nx === '|') { cur += '|'; k++; }
      else if (nx === '\\') { cur += '\\'; k++; }
      else { cur += ch; }
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  for (let k = 0; k < cells.length; k++) {
    cells[k] = cells[k].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  }
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// Validate a table header + delimiter pair. Returns {aligns} or null.
function tableInfo(header, delim) {
  if (header.indexOf('|') === -1) return null;
  const hCells = splitTableRow(header);
  const dCells = splitTableRow(delim);
  if (hCells.length !== dCells.length || hCells.length === 0) return null;
  const aligns = [];
  for (const cell of dCells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    if (cell.charCodeAt(0) === 58 && cell.charCodeAt(cell.length - 1) === 58) {
      aligns.push('center');
    } else if (cell.charCodeAt(cell.length - 1) === 58) {
      aligns.push('right');
    } else if (cell.charCodeAt(0) === 58) {
      aligns.push('left');
    } else {
      aligns.push(null);
    }
  }
  return { aligns };
}

// Try to parse a link reference definition starting at lines[i]. Pure:
// returns {end, label, dest, title} (end = index after the last consumed
// line) or null. A definition spans the lines until the first blank line
// (cap 10), so a title may run over several lines — but a title may not
// span a blank line, and nothing after the destination may cross one.
function parseRefDef(lines, i, end) {
  const ind = indentOf(lines[i]);
  if (ind.col > 3) return null;
  const chunkLines = [];
  for (let k = i; k < end && chunkLines.length < 10; k++) {
    if (k > i && blankLine(lines[k])) break;
    chunkLines.push(lines[k]);
  }
  const chunk = chunkLines.join('\n');
  let p = ind.idx;
  if (chunk.charCodeAt(p) !== 91) return null; // [
  const close = findClosingBracket(chunk, p);
  if (close === -1) return null;
  const label = normalizeLabel(chunk.slice(p + 1, close));
  if (label === '') return null;
  p = close + 1;
  // skip spaces/tabs (not newlines yet), then ':'
  while (p < chunk.length && (chunk.charCodeAt(p) === 32 || chunk.charCodeAt(p) === 9)) p++;
  if (p >= chunk.length || chunk.charCodeAt(p) !== 58) return null; // :
  p++;
  // destination: spaces/tabs, then at most one newline + spaces/tabs
  while (p < chunk.length && (chunk.charCodeAt(p) === 32 || chunk.charCodeAt(p) === 9)) p++;
  if (p < chunk.length && chunk.charCodeAt(p) === 10) {
    p++;
    while (p < chunk.length && (chunk.charCodeAt(p) === 32 || chunk.charCodeAt(p) === 9)) p++;
    if (p < chunk.length && chunk.charCodeAt(p) === 10) return null;
  }
  const isAngle = p < chunk.length && chunk.charCodeAt(p) === 60;
  const d = parseLinkDest(chunk, p);
  if (!d) return null;
  if (d.dest === '' && !isAngle) return null; // empty dest only as <>
  const dest = d.dest;
  const destEnd = d.end;
  // after the dest: spaces/tabs only, on this line
  let q = destEnd;
  while (q < chunk.length && (chunk.charCodeAt(q) === 32 || chunk.charCodeAt(q) === 9)) q++;
  let title = null;
  let endPos;
  if (q < chunk.length && chunk.charCodeAt(q) !== 10) {
    // something on the dest line after the destination
    if (q === destEnd) return null; // no separating whitespace
    const qc = chunk.charCodeAt(q);
    if (qc !== 34 && qc !== 39 && qc !== 40) return null; // junk, not a title
    const t = parseLinkTitle(chunk, q);
    if (!t) return null;
    if (/\n[ \t]*\n/.test(chunk.slice(q, t.end))) return null;
    let r = t.end;
    while (r < chunk.length && (chunk.charCodeAt(r) === 32 || chunk.charCodeAt(r) === 9)) r++;
    if (r < chunk.length && chunk.charCodeAt(r) !== 10) return null;
    title = t.title;
    endPos = r;
  } else {
    // dest line ends here (q is at \n or at end of chunk); a title may
    // follow on the next line — if it does not parse cleanly, the
    // definition simply has no title and ends at the dest line
    endPos = q;
    if (q < chunk.length && chunk.charCodeAt(q) === 10) {
      let s = q + 1;
      while (s < chunk.length && (chunk.charCodeAt(s) === 32 || chunk.charCodeAt(s) === 9)) s++;
      if (s < chunk.length && (chunk.charCodeAt(s) === 34 || chunk.charCodeAt(s) === 39 || chunk.charCodeAt(s) === 40)) {
        const t = parseLinkTitle(chunk, s);
        if (t) {
          if (/\n[ \t]*\n/.test(chunk.slice(s, t.end))) return null;
          let r = t.end;
          while (r < chunk.length && (chunk.charCodeAt(r) === 32 || chunk.charCodeAt(r) === 9)) r++;
          if (r >= chunk.length || chunk.charCodeAt(r) === 10) {
            title = t.title;
            endPos = r;
          }
        }
      }
    }
  }
  // number of newlines consumed before endPos = lines consumed - 1
  let consumed = 0;
  for (let k = 0; k < endPos; k++) {
    if (chunk.charCodeAt(k) === 10) consumed++;
  }
  return { end: i + consumed + 1, label, dest, title };
}

// Cheap single-line check used only by the open-paragraph state machine:
// does this line look like the start of a link reference definition?
function looksLikeRefDef(line) {
  const ind = indentOf(line);
  if (ind.col > 3) return false;
  if (line.charCodeAt(ind.idx) !== 91) return false; // [
  const close = findClosingBracket(line, ind.idx);
  if (close === -1) return false;
  let p = close + 1;
  while (p < line.length && (line.charCodeAt(p) === 32 || line.charCodeAt(p) === 9)) p++;
  return p < line.length && line.charCodeAt(p) === 58;
}

// Does this line start a block that interrupts a paragraph? `nextLine` is
// the following line (for the table check) or null.
function isInterruptingBlockStart(line, nextLine) {
  if (parseAtx(line)) return true;
  if (parseFenceStart(line)) return true;
  if (isHrLine(line)) return true;
  const html = parseHtmlBlockStart(line);
  if (html && html.type !== 7) return true;
  const ind = indentOf(line);
  if (ind.col <= 3 && line.charCodeAt(ind.idx) === 62) return true; // >
  const m = parseMarker(line);
  if (m && !m.empty) {
    if (m.kind === 'bullet') return true;
    if (m.num === 1) return true;
  }
  if (
    nextLine !== null &&
    nextLine !== undefined &&
    line.indexOf('|') !== -1 &&
    tableInfo(line, nextLine)
  ) {
    return true;
  }
  return false;
}

// Classify one line as seen from a "no open paragraph" position.
// Returns 'para' (starts a paragraph here), 'nested-para' (starts a
// paragraph inside a nested list/blockquote) or 'block'.
function classifyLine(line, nextLine) {
  if (blankLine(line)) return 'block';
  if (looksLikeRefDef(line)) return 'block';
  if (isHrLine(line)) return 'block';
  if (parseAtx(line)) return 'block';
  if (parseFenceStart(line)) return 'block';
  const html = parseHtmlBlockStart(line);
  if (html && html.type !== 7) return 'block';
  const ind = indentOf(line);
  if (ind.col >= 4) return 'block'; // indented code
  if (
    nextLine !== null &&
    nextLine !== undefined &&
    line.indexOf('|') !== -1 &&
    tableInfo(line, nextLine)
  ) {
    return 'block';
  }
  if (ind.col <= 3 && line.charCodeAt(ind.idx) === 62) {
    // blockquote marker: classify the content after it
    const content = stripContainerCols(line, ind.idx + 1, ind.col + 2);
    if (blankLine(content)) return 'block';
    const c = classifyLine(content, null);
    return c === 'para' ? 'nested-para' : c;
  }
  const m = parseMarker(line);
  if (m) {
    if (m.empty) return 'block';
    const content = m.firstContent;
    if (blankLine(content)) return 'block';
    const c = classifyLine(content, null);
    return c === 'para' ? 'nested-para' : c;
  }
  // a setext underline on its own is paragraph text
  return 'para';
}

// Does this array of (container-stripped) lines end with an open paragraph?
// Returns {open, lineCount, lastLen, nested}: lineCount is the number of
// lines in the open paragraph, lastLen the length of its last line (sentinel
// stripped), nested whether the paragraph sits inside a nested list or
// blockquote.
function paragraphInfo(lines) {
  let start = 0;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (blankLine(lines[k])) {
      start = k + 1;
      break;
    }
    if (k === 0) start = 0;
  }
  const suffix = lines.slice(start);
  if (suffix.length === 0) {
    return { open: false, lineCount: 0, lastLen: 0, nested: false };
  }
  let state = 'block';
  let paraStart = -1;
  let paraNested = false;
  for (let k = 0; k < suffix.length; k++) {
    const line = suffix[k];
    const next = k + 1 < suffix.length ? suffix[k + 1] : null;
    if (state === 'para') {
      if (isSetextLine(line)) {
        state = 'block';
        paraStart = -1;
        paraNested = false;
        continue;
      }
      if (isInterruptingBlockStart(line, next)) {
        state = 'block';
        paraStart = -1;
        paraNested = false;
        // fall through: re-classify this line from 'block'
      } else {
        continue;
      }
    }
    const c = classifyLine(line, next);
    if (c === 'para') {
      state = 'para';
      paraStart = k;
      paraNested = false;
    } else if (c === 'nested-para') {
      state = 'para';
      paraStart = k;
      paraNested = true;
    } else {
      state = 'block';
      paraStart = -1;
      paraNested = false;
    }
  }
  if (state !== 'para') {
    return { open: false, lineCount: 0, lastLen: 0, nested: false };
  }
  const lastLine = stripSentinel(suffix[suffix.length - 1]);
  return {
    open: true,
    lineCount: suffix.length - paraStart,
    lastLen: lastLine.length,
    nested: paraNested,
  };
}

// Can this line lazily continue an open paragraph inside a container?
// (Table headers, ref defs and indented-looking lines ARE lazy text;
// ATX, fences, HRs, HTML blocks 1-6, blockquotes and interrupting list
// markers are not.)
function isLazyLine(line, nextLine) {
  if (blankLine(line)) return false;
  if (parseAtx(line)) return false;
  if (parseFenceStart(line)) return false;
  if (isHrLine(line)) return false;
  const html = parseHtmlBlockStart(line);
  if (html && html.type !== 7) return false;
  const ind = indentOf(line);
  if (ind.col <= 3 && line.charCodeAt(ind.idx) === 62) return false; // >
  const m = parseMarker(line);
  if (m && !m.empty) {
    if (m.kind === 'bullet') return false;
    if (m.num === 1) return false;
  }
  return true;
}

// Join paragraph lines: a line ending in 2+ spaces is joined with a hard
// break sentinel, other lines with \n. The trailing spaces that mark a
// hard break are stripped (they are the marker, not content); the last
// line keeps its trailing spaces. NOSETEXT prefixes are stripped.
function joinParaLines(paraLines) {
  let out = '';
  for (let k = 0; k < paraLines.length; k++) {
    let line = stripSentinel(paraLines[k]);
    if (k > 0) {
      const prev = stripSentinel(paraLines[k - 1]);
      let trailing = 0;
      for (let t = prev.length - 1; t >= 0 && prev.charCodeAt(t) === 32; t--) {
        trailing++;
      }
      out += trailing >= 2 ? HARD_BREAK : '\n';
    }
    if (k < paraLines.length - 1) {
      let trailing = 0;
      for (let t = line.length - 1; t >= 0 && line.charCodeAt(t) === 32; t--) {
        trailing++;
      }
      if (trailing >= 2) line = line.slice(0, line.length - trailing);
    }
    out += line;
  }
  return out;
}

// Parse a fenced code block starting at lines[i]. Content lines lose the
// opening fence's indent; at most one trailing line is removed, and only
// if it is empty.
function parseFence(lines, i, end) {
  const start = parseFenceStart(lines[i]);
  const info = start.info.replace(/^[ \t]+/, '');
  let lang = info.split(/[ \t]/)[0] || '';
  lang = lang.replace(/\\([!-/:-@\[-`{-~])/g, '$1');
  const dedent = indentOf(lines[i]).col;
  const content = [];
  let j = i + 1;
  while (j < end) {
    if (isFenceClose(lines[j], start.fenceChar, start.len)) {
      j++;
      break;
    }
    content.push(stripIndentCols(lines[j], dedent));
    j++;
  }
  if (content.length > 0 && content[content.length - 1] === '') {
    content.pop();
  }
  const text = content.length > 0 ? content.join('\n') + '\n' : '';
  return { node: { t: 'fence', lang, text }, next: j };
}

// Parse an indented code block starting at lines[i].
function parseIndentedCode(lines, i, end) {
  const codeLines = [];
  let j = i;
  while (j < end) {
    const line = lines[j];
    if (blankLine(line)) {
      let k = j;
      while (k < end && blankLine(lines[k])) k++;
      if (k < end && indentOf(lines[k]).col >= 4) {
        while (j < k) {
          codeLines.push(stripIndentCols(lines[j], 4));
          j++;
        }
        continue;
      }
      break;
    }
    if (indentOf(line).col >= 4) {
      codeLines.push(stripIndentCols(line, 4));
      j++;
    } else {
      break;
    }
  }
  while (
    codeLines.length > 0 &&
    codeLines[codeLines.length - 1] === ''
  ) {
    codeLines.pop();
  }
  const text = codeLines.length > 0 ? codeLines.join('\n') + '\n' : '';
  return { node: { t: 'code', text }, next: j };
}

// Parse an HTML block starting at lines[i].
function parseHtmlBlock(lines, i, end) {
  const start = parseHtmlBlockStart(lines[i]);
  const textLines = [lines[i]];
  let j = i + 1;
  if (start.type === 1) {
    const closeRe = new RegExp('</' + start.tag + '\\s*>', 'i');
    // the closing tag may already be on the opening line
    if (closeRe.test(lines[i])) {
      j = i + 1;
    } else {
      while (j < end) {
        textLines.push(lines[j]);
        if (closeRe.test(lines[j])) {
          j++;
          break;
        }
        j++;
      }
    }
  } else if (start.type === 2) {
    if (lines[i].indexOf(start.endMarker, start.searchFrom) === -1) {
      while (j < end) {
        textLines.push(lines[j]);
        if (lines[j].indexOf(start.endMarker) !== -1) {
          j++;
          break;
        }
        j++;
      }
    }
  } else {
    // types 6 and 7 end at a blank line (a type 6 block does NOT end at
    // its closing tag — following lines stay raw HTML until a blank line)
    while (j < end) {
      const line = lines[j];
      if (blankLine(line)) break;
      textLines.push(line);
      j++;
    }
  }
  const lastK = i + textLines.length - 1;
  let text = textLines.join('\n');
  const terminated = lastK < lines.length - 1;
  const nextIsRealBlank =
    lastK + 1 < lines.length &&
    blankLine(lines[lastK + 1]) &&
    !(lastK + 1 === lines.length - 1 && SRC_ENDS_NL);
  if (terminated && !nextIsRealBlank) text += '\n';
  return { node: { t: 'html', text }, next: j };
}

// Parse a table starting at lines[i] (header) with lines[i+1] the delimiter.
function parseTable(lines, i, end) {
  const info = tableInfo(lines[i], lines[i + 1]);
  const header = splitTableRow(lines[i]);
  const aligns = info.aligns;
  const rows = [];
  let j = i + 2;
  while (j < end) {
    const line = lines[j];
    if (blankLine(line)) break;
    if (parseAtx(line)) break;
    if (parseFenceStart(line)) break;
    if (isHrLine(line)) break;
    const html = parseHtmlBlockStart(line);
    if (html && html.type !== 7) break;
    const ind = indentOf(line);
    if (ind.col >= 4) break;
    if (ind.col <= 3 && line.charCodeAt(ind.idx) === 62) break; // >
    if (parseMarker(line)) break;
    rows.push(splitTableRow(line));
    j++;
  }
  return { node: { t: 'table', header, aligns, rows }, next: j };
}

// Parse a blockquote starting at lines[i].
function parseBlockquote(lines, i, end, refs) {
  const content = [];
  let j = i;
  let pending = [];
  let prevLazy = false;
  while (j < end) {
    const line = lines[j];
    if (blankLine(line)) {
      pending.push(line);
      j++;
      continue;
    }
    const ind = indentOf(line);
    if (ind.col <= 3 && line.charCodeAt(ind.idx) === 62) {
      // '>' marker: strip it plus one following column
      for (let b = 0; b < pending.length; b++) content.push('');
      pending = [];
      content.push(stripContainerCols(line, ind.idx + 1, ind.col + 2));
      prevLazy = false;
      j++;
      continue;
    }
    // no marker: lazy continuation?
    if (pending.length === 0) {
      const info = paragraphInfo(content);
      if (info.open && isLazyLine(line, j + 1 < end ? lines[j + 1] : null)) {
        if (isSetextLine(line)) {
          if (info.nested) {
            content.push(line);
          } else if (prevLazy) {
            content.push('    ' + line);
          } else {
            content.push(NOSETEXT + line);
          }
        } else {
          content.push(line);
        }
        prevLazy = true;
        j++;
        continue;
      }
    }
    break;
  }
  const inner = parseBlocks(content, 0, content.length, refs);
  return { node: { t: 'blockquote', children: inner.nodes }, next: j };
}

function sameListType(m, first) {
  if (m.kind !== first.kind) return false;
  if (m.kind === 'bullet') return m.bullet === first.bullet;
  return m.delim === first.delim;
}

// Parse one list item starting at lines[j] with marker `m`. Returns
// {item, loose, next, blankBeforeNext}.
function parseListItem(lines, j, end, refs, first, m) {
  const contentIndent = m.contentIndent;
  const contentLines = [m.firstContent];
  let hasContent = m.firstContent.replace(/^[ \t]+/, '') !== '';
  let k = j + 1;
  let pending = [];
  while (k < end) {
    const line = lines[k];
    if (blankLine(line)) {
      // an item can begin with at most one blank line: an empty first line
      // followed by a blank line ends the item here
      if (!hasContent && pending.length === 0) break;
      pending.push(line);
      k++;
      continue;
    }
    const ind = indentOf(line);
    if (ind.col >= contentIndent) {
      for (let b = 0; b < pending.length; b++) contentLines.push('');
      pending = [];
      contentLines.push(stripContainerCols(line, 0, contentIndent));
      hasContent = true;
      k++;
      continue;
    }
    const mk = parseMarker(line);
    if (mk && mk.indent < contentIndent) {
      // a marker less indented than the content: a new item of this list,
      // or the end of this list (a different marker)
      break;
    }
    // lazy continuation?
    if (pending.length === 0) {
      const info = paragraphInfo(contentLines);
      if (info.open && isLazyLine(line, k + 1 < end ? lines[k + 1] : null)) {
        if (isSetextLine(line)) {
          if (info.nested) {
            contentLines.push(line);
          } else if (
            isEqualsRun(line) &&
            info.lineCount >= 2 &&
            info.lastLen <= 2
          ) {
            contentLines.push(line);
          } else {
            contentLines.push(NOSETEXT + line);
          }
        } else {
          contentLines.push(line);
        }
        hasContent = true;
        k++;
        continue;
      }
    }
    break;
  }
  // marked trims the item's raw text: strip trailing spaces/tabs from the
  // last content line
  if (contentLines.length > 0) {
    const last = contentLines[contentLines.length - 1];
    contentLines[contentLines.length - 1] = last.replace(/[ \t]+$/, '');
  }
  const inner = parseBlocks(contentLines, 0, contentLines.length, refs);
  return {
    item: { nodes: inner.nodes },
    loose: inner.loose,
    next: k,
    blankBeforeNext: pending.length > 0,
  };
}

// Parse a list starting at lines[i] (a marker line).
function parseList(lines, i, end, refs) {
  const first = parseMarker(lines[i]);
  const ordered = first.kind === 'ordered';
  const items = [];
  let loose = false;
  let j = i;
  let prevContentIndent = first.contentIndent;
  while (j < end) {
    // a line that is a thematic break as a whole is an HR, not a new item
    if (isHrLine(lines[j])) break;
    const m = parseMarker(lines[j]);
    if (
      !m ||
      !sameListType(m, first) ||
      m.indent >= prevContentIndent
    ) {
      break;
    }
    const res = parseListItem(lines, j, end, refs, first, m);
    items.push(res.item);
    if (res.loose) loose = true;
    prevContentIndent = m.contentIndent;
    // skip blank lines between items; they make the list loose when
    // another item of this list follows
    let k = res.next;
    let skipped = res.blankBeforeNext ? 1 : 0;
    while (k < end && blankLine(lines[k])) {
      skipped++;
      k++;
    }
    if (k < end) {
      const m2 = parseMarker(lines[k]);
      if (
        m2 &&
        !isHrLine(lines[k]) &&
        sameListType(m2, first) &&
        m2.indent < prevContentIndent
      ) {
        if (skipped > 0) loose = true;
        j = k;
        continue;
      }
    }
    j = k;
    break;
  }
  return {
    node: {
      t: 'list',
      ordered,
      start: ordered ? first.num : 1,
      items,
      loose,
    },
    next: j,
  };
}

// Parse the blocks in lines[start..end). Returns {nodes, next, loose} where
// loose is true when a blank line falls between two consumed things (a block
// or a link reference definition) at this level.
function parseBlocks(lines, start, end, refs) {
  const nodes = [];
  let i = start;
  let loose = false;
  let seenThing = false;
  let pendingBlank = false;
  while (i < end) {
    const line = lines[i];
    if (blankLine(line)) {
      if (seenThing) pendingBlank = true;
      i++;
      continue;
    }
    const lineInd = indentOf(line);
    const def =
      lineInd.col <= 3 && line.charCodeAt(lineInd.idx) === 91
        ? parseRefDef(lines, i, end)
        : null;
    if (def) {
      if (pendingBlank && seenThing) loose = true;
      const key = def.label;
      if (refs[key] === undefined) {
        refs[key] = { dest: def.dest, title: def.title };
      }
      seenThing = true;
      pendingBlank = false;
      i = def.end;
      continue;
    }
    if (pendingBlank && seenThing) loose = true;
    // dispatch on the block type
    const ind = indentOf(line);
    let r = null;
    if (ind.col >= 4) {
      r = parseIndentedCode(lines, i, end);
    } else if (parseFenceStart(line)) {
      r = parseFence(lines, i, end);
    } else if (parseAtx(line)) {
      const atx = parseAtx(line);
      r = { node: { t: 'heading', level: atx.level, text: atx.text }, next: i + 1 };
    } else if (parseHtmlBlockStart(line)) {
      r = parseHtmlBlock(lines, i, end);
    } else if (isHrLine(line)) {
      r = { node: { t: 'hr' }, next: i + 1 };
    } else if (parseMarker(line)) {
      r = parseList(lines, i, end, refs);
    } else if (ind.col <= 3 && line.charCodeAt(ind.idx) === 62) {
      r = parseBlockquote(lines, i, end, refs);
    } else if (
      line.indexOf('|') !== -1 &&
      i + 1 < end &&
      tableInfo(line, lines[i + 1])
    ) {
      r = parseTable(lines, i, end);
    } else {
      r = parseParagraph(lines, i, end, refs);
    }
    nodes.push(r.node);
    seenThing = true;
    pendingBlank = false;
    i = r.next;
  }
  return { nodes, next: i, loose };
}

// Parse a paragraph (or setext heading) starting at lines[i].
function parseParagraph(lines, i, end, refs) {
  const paraLines = [];
  let j = i;
  while (j < end) {
    const line = lines[j];
    if (blankLine(line)) break;
    if (paraLines.length > 0 && isSetextLine(line)) {
      const ind = indentOf(line);
      const level = line.charCodeAt(ind.idx) === 61 ? 1 : 2;
      const text = joinParaLines(paraLines).replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '');
      return { node: { t: 'heading', level, text }, next: j + 1 };
    }
    if (paraLines.length > 0) {
      const next = j + 1 < end ? lines[j + 1] : null;
      if (isInterruptingBlockStart(line, next)) break;
    }
    paraLines.push(line);
    j++;
  }
  const text = joinParaLines(paraLines);
  return { node: { t: 'para', text }, next: j };
}

// ---- rendering ------------------------------------------------------------

function renderTable(node, refs) {
  let out = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < node.header.length; c++) {
    const a = node.aligns[c];
    out +=
      '<th' +
      (a ? ' align="' + a + '"' : '') +
      '>' +
      parseInline(node.header[c], refs, false, false) +
      '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (node.rows.length > 0) {
    out += '<tbody>';
    for (const row of node.rows) {
      out += '<tr>\n';
      for (let c = 0; c < node.header.length; c++) {
        const a = node.aligns[c];
        const cell = c < row.length ? row[c] : '';
        out +=
          '<td' +
          (a ? ' align="' + a + '"' : '') +
          '>' +
          parseInline(cell, refs, false, false) +
          '</td>\n';
      }
      out += '</tr>\n';
    }
    out += '</tbody></table>\n';
  } else {
    out += '</table>\n';
  }
  return out;
}

function renderList(node, refs) {
  const tag = node.ordered ? 'ol' : 'ul';
  const startAttr =
    node.ordered && node.start !== 1 ? ' start="' + node.start + '"' : '';
  let out = '<' + tag + startAttr + '>\n';
  for (const item of node.items) {
    out += '<li>';
    const nodes = item.nodes;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'para') {
        let text = n.text;
        let prefix = '';
        if (k === 0) {
          const m = /^\[( |x|X)\][ \t]/.exec(text);
          if (m) {
            prefix =
              m[1] === ' '
                ? '<input disabled="" type="checkbox"> '
                : '<input checked="" disabled="" type="checkbox"> ';
            text = text.slice(m[0].length);
          }
        }
        if (node.loose) {
          out +=
            '<p>' + prefix + parseInline(text, refs, false, false) + '</p>\n';
        } else {
          out += prefix + parseInline(text, refs, false, false);
        }
      } else {
        out += renderNode(n, refs);
      }
    }
    out += '</li>\n';
  }
  out += '</' + tag + '>\n';
  return out;
}

function renderNode(node, refs) {
  switch (node.t) {
    case 'para':
      return '<p>' + parseInline(node.text, refs, false, false) + '</p>\n';
    case 'heading':
      return (
        '<h' +
        node.level +
        '>' +
        parseInline(node.text, refs, false, false) +
        '</h' +
        node.level +
        '>\n'
      );
    case 'hr':
      return '<hr>\n';
    case 'code':
      return '<pre><code>' + escapeAll(node.text) + '</code></pre>\n';
    case 'fence':
      return (
        '<pre><code' +
        (node.lang
          ? ' class="language-' + escapeAttr(node.lang) + '"'
          : '') +
        '>' +
        escapeAll(node.text) +
        '</code></pre>\n'
      );
    case 'html':
      return node.text;
    case 'blockquote':
      return (
        '<blockquote>\n' + renderNodes(node.children, refs) + '</blockquote>\n'
      );
    case 'list':
      return renderList(node, refs);
    case 'table':
      return renderTable(node, refs);
    default:
      return '';
  }
}

function renderNodes(nodes, refs) {
  let out = '';
  for (const node of nodes) out += renderNode(node, refs);
  return out;
}

// ---- entry point ----------------------------------------------------------

// The HTML marked 18.1.3 renders for `markdown` with its default options
// (GFM on, breaks off, pedantic off, async off).
export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  SRC_ENDS_NL = src.charCodeAt(src.length - 1) === 10;
  // pick sentinel characters that do not occur in the source
  HARD_BREAK = '\u0001';
  NOSETEXT = '\u0002';
  if (src.indexOf(HARD_BREAK) !== -1) HARD_BREAK = '\u0003';
  if (src.indexOf(NOSETEXT) !== -1) NOSETEXT = '\u0004';
  if (src.indexOf(HARD_BREAK) !== -1) HARD_BREAK = '\u0005';
  if (src.indexOf(NOSETEXT) !== -1) NOSETEXT = '\u0006';
  const lines = src.split('\n');
  const refs = Object.create(null);
  const result = parseBlocks(lines, 0, lines.length, refs);
  return renderNodes(result.nodes, refs);
}
