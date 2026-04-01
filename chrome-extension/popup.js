// This function is injected into the Google Patents tab and runs in its context.
// It must be entirely self-contained (no references to outer scope).
function extractPatentData() {

  // ---- Text cleaning ----

  function cleanText(text) {
    // Rejoin inline reference numbers split across lines (e.g. "screen \n112\n,")
    text = text.replace(
      /[ \t]*\n+[ \t]*((?:FIG\.\s*)?\d+[A-Z]?[a-z]?)\s*\n+[ \t]*/g,
      ' $1 '
    );
    text = text.replace(
      /[ \t]*\n+[ \t]*(\d+[A-Z]?[a-z]?)[ \t]*\n+/g,
      ' $1\n'
    );
    text = text.replace(/[ \t]+/g, ' ');          // collapse spaces/tabs
    text = text.replace(/\n{3,}/g, '\n\n');        // max two consecutive newlines
    text = text.replace(/ *\n */g, '\n');           // trim spaces around newlines
    text = text.replace(/ +([,;:.)\]])/g, '$1');   // remove spaces before punctuation
    return text.trim();
  }

  // Walk the DOM and collect text, inserting newlines only at block-level tags
  // so inline reference numbers (wrapped in <b>/<span>) stay on the same line.
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

  // Find the text between a start heading and the next stop heading.
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

  // Title
  const titleMeta = document.querySelector('meta[name="DC.title"]');
  if (titleMeta) {
    result.title = titleMeta.getAttribute('content').trim();
  } else {
    const h1 = document.querySelector('h1');
    if (h1) result.title = h1.textContent.trim();
  }

  // Patent ID
  const idMeta = document.querySelector('meta[name="DC.identifier"]');
  if (idMeta) result.patent_id = idMeta.getAttribute('content').trim();

  // Abstract
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

  // Description (contains field, background, brief desc, detailed desc)
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

  // Claims
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

  // Fallback: plain text extraction for any field not yet populated
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

  return result;
}

// ---- Popup UI ----

document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('download-btn');
  const status = document.getElementById('status');

  function setStatus(msg, type = '') {
    status.textContent = msg;
    status.className = type;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isPatentPage = tab && tab.url && /patents\.google\.com\/patent\//i.test(tab.url);

  if (!isPatentPage) {
    btn.disabled = true;
    setStatus('Navigate to a Google Patents page first.');
    return;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus('Extracting...');

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPatentData,
      });

      const sections = results[0].result;
      if (!sections) throw new Error('No data returned from page.');

      const patentId = sections.patent_id || 'patent';
      const patentNum = (patentId.match(/\d+/) || [patentId])[0];

      // Build combined markdown
      const sectionBlocks = [
        ['Abstract',                      sections.abstract],
        ['Field of Invention',            sections.field_of_invention],
        ['Background',                    sections.background],
        ['Brief Description of Drawings', sections.brief_description_of_drawings],
        ['Detailed Description',          sections.detailed_description],
        ['Claims',                        sections.claims],
      ];

      let md = `# ${sections.title || patentId}\n\n`;
      md += `**Patent ID:** ${patentId}\n\n`;
      md += `---\n\n`;
      for (const [heading, body] of sectionBlocks) {
        md += `## ${heading}\n\n`;
        md += (body ? body : '*Section not found in the patent document.*') + '\n\n';
      }

      // Trigger download
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patent_${patentNum}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus(`Saved: patent_${patentNum}.md`, 'success');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
});
