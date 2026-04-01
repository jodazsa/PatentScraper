// Runs inside the Google Patents tab — must be entirely self-contained.
function extractAndDownload() {

  // ---- Text cleaning ----

  function cleanText(text) {
    text = text.replace(
      /[ \t]*\n+[ \t]*((?:FIG\.\s*)?\d+[A-Z]?[a-z]?)\s*\n+[ \t]*/g,
      ' $1 '
    );
    text = text.replace(
      /[ \t]*\n+[ \t]*(\d+[A-Z]?[a-z]?)[ \t]*\n+/g,
      ' $1\n'
    );
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/ *\n */g, '\n');
    text = text.replace(/ +([,;:.)\]])/g, '$1');
    return text.trim();
  }

  function blockAwareText(el) {
    const BLOCK = new Set([
      'P','DIV','BR','H1','H2','H3','H4','H5','H6',
      'LI','TR','BLOCKQUOTE','SECTION','ARTICLE','FIGCAPTION','HEADING',
    ]);
    const parts = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) { parts.push(t); parts.push(' '); }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (BLOCK.has(node.tagName)) parts.push('\n');
        for (const child of node.childNodes) walk(child);
      }
    }

    walk(el);
    let raw = parts.join('');
    raw = raw.replace(/[ \t]+/g, ' ');
    raw = raw.replace(/ *\n */g, '\n');
    return cleanText(raw);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractSubsection(text, startHeadings, stopHeadings) {
    const lines = text.split('\n');
    let startIdx = null;

    const startPats = startHeadings.map(
      h => new RegExp('^\\s*' + escapeRe(h) + '\\s*$', 'i')
    );
    const stopPats = stopHeadings.map(
      h => new RegExp('^\\s*' + escapeRe(h), 'i')
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (startIdx === null) {
        for (const pat of startPats) {
          if (pat.test(line)) { startIdx = i + 1; break; }
        }
      } else {
        for (const pat of stopPats) {
          if (pat.test(line)) {
            return cleanText(lines.slice(startIdx, i).join('\n'));
          }
        }
      }
    }

    if (startIdx !== null) return cleanText(lines.slice(startIdx).join('\n'));
    return '';
  }

  // ---- Main extraction ----

  const result = {
    title: '', patent_id: '', abstract: '',
    field_of_invention: '', background: '',
    brief_description_of_drawings: '', detailed_description: '', claims: '',
  };

  const titleMeta = document.querySelector('meta[name="DC.title"]');
  if (titleMeta) {
    result.title = titleMeta.getAttribute('content').trim();
  } else {
    const h1 = document.querySelector('h1');
    if (h1) result.title = h1.textContent.trim();
  }

  const idMeta = document.querySelector('meta[name="DC.identifier"]');
  if (idMeta) {
    result.patent_id = idMeta.getAttribute('content').trim();
  } else {
    const pubnumEl = document.querySelector('#pubnum') ||
                     document.querySelector('[data-proto="PublicationNumber"]');
    if (pubnumEl) {
      result.patent_id = pubnumEl.textContent.trim();
    } else {
      const m = window.location.pathname.match(/\/patent\/([^/]+)/);
      if (m) result.patent_id = m[1];
    }
  }

  let abstractEl = document.querySelector('.abstract.patent-text') ||
                   document.querySelector('div.abstract');
  if (!abstractEl) {
    for (const h of document.querySelectorAll('h1,h2,h3,h4')) {
      if (/^\s*abstract\s*$/i.test(h.textContent.trim())) {
        abstractEl = h.nextElementSibling;
        break;
      }
    }
  }
  if (abstractEl) result.abstract = blockAwareText(abstractEl);

  const descEl = document.querySelector('.description.patent-text') ||
                 document.querySelector('[itemprop="description"]');
  if (descEl) {
    const dt = blockAwareText(descEl);

    result.field_of_invention = extractSubsection(dt,
      ['TECHNICAL FIELD', 'FIELD OF THE INVENTION', 'FIELD OF INVENTION', 'FIELD'],
      ['BACKGROUND', 'SUMMARY', 'BRIEF DESCRIPTION', 'DETAILED DESCRIPTION', 'DESCRIPTION OF']
    );
    result.background = extractSubsection(dt,
      ['BACKGROUND OF THE INVENTION', 'BACKGROUND'],
      ['SUMMARY', 'BRIEF DESCRIPTION', 'DETAILED DESCRIPTION', 'DESCRIPTION OF']
    );
    result.brief_description_of_drawings = extractSubsection(dt,
      ['BRIEF DESCRIPTION OF THE DRAWINGS', 'BRIEF DESCRIPTION OF DRAWINGS',
       'DESCRIPTION OF THE DRAWINGS', 'DESCRIPTION OF DRAWINGS'],
      ['DETAILED DESCRIPTION', 'DESCRIPTION OF THE PREFERRED', 'DESCRIPTION OF EMBODIMENTS',
       'DESCRIPTION OF THE EMBODIMENTS', 'DETAILED DESCRIPTION OF', 'SUMMARY']
    );
    result.detailed_description = extractSubsection(dt,
      ['DETAILED DESCRIPTION', 'DETAILED DESCRIPTION OF THE INVENTION',
       'DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS', 'DETAILED DESCRIPTION OF EMBODIMENTS',
       'DESCRIPTION OF THE PREFERRED EMBODIMENTS', 'DESCRIPTION OF EMBODIMENTS'],
      ['CLAIMS', 'What is claimed is:', 'What is claimed:', 'I claim:', 'We claim:']
    );
  }

  let claimsEl = document.querySelector('.claims.patent-text') ||
                 document.querySelector('div.claims') ||
                 document.querySelector('[itemprop="claims"]');
  if (!claimsEl) {
    for (const h of document.querySelectorAll('h1,h2,h3,h4')) {
      if (/^\s*claims\s*$/i.test(h.textContent.trim())) {
        claimsEl = h.nextElementSibling;
        break;
      }
    }
  }
  if (claimsEl) result.claims = blockAwareText(claimsEl);

  // Fallback: plain text extraction
  const fullText = document.body ? document.body.innerText : '';
  if (!result.abstract)
    result.abstract = extractSubsection(fullText,
      ['Abstract'], ['Description', 'Claims', 'Images', 'Classifications']);
  if (!result.field_of_invention)
    result.field_of_invention = extractSubsection(fullText,
      ['TECHNICAL FIELD', 'FIELD OF THE INVENTION', 'FIELD OF INVENTION'],
      ['BACKGROUND', 'SUMMARY', 'BRIEF DESCRIPTION']);
  if (!result.background)
    result.background = extractSubsection(fullText,
      ['BACKGROUND'], ['SUMMARY', 'BRIEF DESCRIPTION', 'DETAILED DESCRIPTION']);
  if (!result.brief_description_of_drawings)
    result.brief_description_of_drawings = extractSubsection(fullText,
      ['BRIEF DESCRIPTION OF THE DRAWINGS', 'BRIEF DESCRIPTION OF DRAWINGS'],
      ['DETAILED DESCRIPTION', 'DESCRIPTION OF THE PREFERRED']);
  if (!result.detailed_description)
    result.detailed_description = extractSubsection(fullText,
      ['DETAILED DESCRIPTION', 'DETAILED DESCRIPTION OF THE INVENTION',
       'DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS',
       'DESCRIPTION OF THE PREFERRED EMBODIMENTS'],
      ['CLAIMS', 'What is claimed is:', 'What is claimed:']);
  if (!result.claims)
    result.claims = extractSubsection(fullText,
      ['Claims'], ['Description', 'Referenced by', 'Patent Citations']);

  // ---- Build text & trigger download ----

  const patentId = result.patent_id || 'patent';
  const patentNum = patentId.replace(/[^A-Za-z0-9_\-]/g, '_');

  const sectionBlocks = [
    ['ABSTRACT',                        result.abstract],
    ['FIELD OF INVENTION',              result.field_of_invention],
    ['BACKGROUND',                      result.background],
    ['BRIEF DESCRIPTION OF DRAWINGS',   result.brief_description_of_drawings],
    ['DETAILED DESCRIPTION',            result.detailed_description],
    ['CLAIMS',                          result.claims],
  ];

  let txt = `${result.title || patentId}\n`;
  txt += `Patent ID: ${patentId}\n\n`;
  for (const [heading, body] of sectionBlocks) {
    txt += `${heading}\n\n`;
    txt += (body ? body : 'Section not found in the patent document.') + '\n\n';
  }

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patent_${patentNum}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Service worker ----

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !/patents\.google\.com\/patent\//i.test(tab.url)) return;

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractAndDownload,
  });
});
