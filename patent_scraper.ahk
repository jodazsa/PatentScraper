; Patent to Markdown - AutoHotkey v2
; Mirrors the Chrome extension: fetches a Google Patents page, extracts
; structured patent text, and saves it as a .txt file.
;
; Usage:
;   1. Open Chrome or Edge and navigate to a Google Patents page.
;   2. Press Win+P to trigger extraction.
;   3. The patent is saved to OutputDir (default: Documents\PatentData).
;
; Requirements: AutoHotkey v2.0+, Windows

#Requires AutoHotkey v2.0
#SingleInstance Force

; ── Configuration ──────────────────────────────────────────────────────────────

; Where to save the .txt files. Change to any path you prefer.
OutputDir := A_MyDocuments "\PatentData"

; ── Hotkey ─────────────────────────────────────────────────────────────────────

; Win+P  – extract the patent shown in the active Chrome / Edge tab.
#p:: ExtractPatent()

; ── Main workflow ───────────────────────────────────────────────────────────────

ExtractPatent() {
    global OutputDir

    ; Ensure output directory exists
    if !DirExist(OutputDir)
        DirCreate(OutputDir)

    ; Grab URL from the active browser window
    url := GetBrowserURL()
    if !url {
        MsgBox("Could not read the browser URL.`nMake sure Chrome or Edge is the active window.",
               "Patent Scraper", "Icon!")
        return
    }

    ; Confirm this is a Google Patents page
    if !RegExMatch(url, "i)patents\.google\.com/patent/") {
        MsgBox("Please navigate to a Google Patents page first.`n`nCurrent URL:`n" url,
               "Patent Scraper", "Icon!")
        return
    }

    TrayTip("Fetching patent data…", "Patent Scraper", 1)

    try {
        html := FetchURL(url)
        if !html
            throw Error("HTTP request returned no content.")

        data    := ParsePatent(html, url)
        txt     := BuildOutput(data)
        rawId   := data["patent_id"] ? data["patent_id"] : "patent"
        safeId  := RegExReplace(rawId, "[^A-Za-z0-9_\-]", "_")
        outFile := OutputDir "\" "patent_" safeId ".txt"

        fh := FileOpen(outFile, "w", "UTF-8")
        if !fh
            throw Error("Could not create file: " outFile)
        fh.Write(txt)
        fh.Close()

        TrayTip("Saved: patent_" safeId ".txt", "Patent Scraper", 1)
        MsgBox("Patent saved successfully!`n`n" outFile, "Patent Scraper", "Iconi")

    } catch Error as e {
        MsgBox("Error: " e.Message, "Patent Scraper", "Icon!")
    }
}

; ── URL capture ─────────────────────────────────────────────────────────────────

GetBrowserURL() {
    ; Accept Chrome, Edge, or any Chromium-based browser
    hwnd := WinExist("A")
    if !hwnd
        return ""

    winExe := WinGetProcessName("ahk_id " hwnd)
    if !RegExMatch(winExe, "i)^(chrome|msedge|brave|vivaldi|opera)\.exe$") {
        ; Not a recognised browser – try to activate one
        for exe in ["chrome.exe", "msedge.exe"] {
            if WinExist("ahk_exe " exe) {
                WinActivate("ahk_exe " exe)
                WinWaitActive("ahk_exe " exe, , 2)
                break
            }
        }
        hwnd := WinExist("A")
        winExe := WinGetProcessName("ahk_id " hwnd)
        if !RegExMatch(winExe, "i)^(chrome|msedge|brave|vivaldi|opera)\.exe$")
            return ""
    }

    ; Preserve the clipboard
    savedClip := ClipboardAll()
    A_Clipboard := ""

    ; Focus the address bar, select all, copy
    Send("^l")
    Sleep(200)
    Send("^a")
    Sleep(50)
    Send("^c")

    url := ClipWait(2) ? Trim(A_Clipboard) : ""

    ; Restore clipboard and return focus to the page
    A_Clipboard := savedClip
    Send("{Esc}")

    return url
}

; ── HTTP fetch ──────────────────────────────────────────────────────────────────

FetchURL(url) {
    http := ComObject("WinHttp.WinHttpRequest.5.1")
    http.Open("GET", url, false)
    ; Mimic a browser so Google Patents returns full HTML
    http.SetRequestHeader("User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36")
    http.SetRequestHeader("Accept-Language", "en-US,en;q=0.9")
    http.SetRequestHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    http.Send()
    return (http.Status = 200) ? http.ResponseText : ""
}

; ── HTML parsing ────────────────────────────────────────────────────────────────

ParsePatent(html, url) {
    data := Map(
        "title",                      "",
        "patent_id",                  "",
        "abstract",                   "",
        "field_of_invention",         "",
        "background",                 "",
        "brief_description_of_drawings", "",
        "detailed_description",       "",
        "claims",                     ""
    )

    ; Load into MSHTML for DOM-based extraction
    doc := ComObject("HTMLFile")
    doc.open()
    doc.write(html)
    doc.close()

    ; ── Title ──
    try {
        m := doc.querySelector('meta[name="DC.title"]')
        if m
            data["title"] := Trim(m.content)
    }
    if !data["title"] {
        try {
            h := doc.querySelector("h1")
            if h
                data["title"] := Trim(h.innerText)
        }
    }

    ; ── Patent ID (three-source cascade) ──
    try {
        m := doc.querySelector('meta[name="DC.identifier"]')
        if m
            data["patent_id"] := Trim(m.content)
    }
    if !data["patent_id"] {
        try {
            el := doc.querySelector("#pubnum")
            if !el
                el := doc.querySelector("[data-proto='PublicationNumber']")
            if el
                data["patent_id"] := Trim(el.innerText)
        }
    }
    if !data["patent_id"] {
        if RegExMatch(url, "i)/patent/([^/?#]+)", &m)
            data["patent_id"] := m[1]
    }

    ; ── Abstract ──
    try {
        el := doc.querySelector(".abstract.patent-text")
        if !el
            el := doc.querySelector("div.abstract")
        if el
            data["abstract"] := CleanText(el.innerText)
    }
    if !data["abstract"]
        data["abstract"] := DOMHeadingSection(doc, "abstract", "")

    ; ── Description (field, background, brief desc, detailed desc) ──
    descText := ""
    try {
        el := doc.querySelector(".description.patent-text")
        if !el
            el := doc.querySelector("[itemprop='description']")
        if el
            descText := CleanText(el.innerText)
    }
    if descText {
        data["field_of_invention"] := ExtractSubsection(descText,
            ["TECHNICAL FIELD", "FIELD OF THE INVENTION", "FIELD OF INVENTION", "FIELD"],
            ["BACKGROUND", "SUMMARY", "BRIEF DESCRIPTION", "DETAILED DESCRIPTION", "DESCRIPTION OF"])
        data["background"] := ExtractSubsection(descText,
            ["BACKGROUND OF THE INVENTION", "BACKGROUND"],
            ["SUMMARY", "BRIEF DESCRIPTION", "DETAILED DESCRIPTION", "DESCRIPTION OF"])
        data["brief_description_of_drawings"] := ExtractSubsection(descText,
            ["BRIEF DESCRIPTION OF THE DRAWINGS", "BRIEF DESCRIPTION OF DRAWINGS",
             "DESCRIPTION OF THE DRAWINGS", "DESCRIPTION OF DRAWINGS"],
            ["DETAILED DESCRIPTION", "DESCRIPTION OF THE PREFERRED", "DESCRIPTION OF EMBODIMENTS",
             "DESCRIPTION OF THE EMBODIMENTS", "DETAILED DESCRIPTION OF", "SUMMARY"])
        data["detailed_description"] := ExtractSubsection(descText,
            ["DETAILED DESCRIPTION", "DETAILED DESCRIPTION OF THE INVENTION",
             "DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS", "DETAILED DESCRIPTION OF EMBODIMENTS",
             "DESCRIPTION OF THE PREFERRED EMBODIMENTS", "DESCRIPTION OF EMBODIMENTS"],
            ["CLAIMS", "What is claimed is:", "What is claimed:", "I claim:", "We claim:"])
    }

    ; ── Claims ──
    try {
        el := doc.querySelector(".claims.patent-text")
        if !el
            el := doc.querySelector("div.claims")
        if !el
            el := doc.querySelector("[itemprop='claims']")
        if el
            data["claims"] := CleanText(el.innerText)
    }
    if !data["claims"]
        data["claims"] := DOMHeadingSection(doc, "claims", "")

    ; ── Fallback: full body text ──
    try {
        fullText := doc.body ? doc.body.innerText : ""
        if fullText {
            if !data["abstract"]
                data["abstract"] := ExtractSubsection(fullText,
                    ["Abstract"],
                    ["Description", "Claims", "Images", "Classifications"])
            if !data["field_of_invention"]
                data["field_of_invention"] := ExtractSubsection(fullText,
                    ["TECHNICAL FIELD", "FIELD OF THE INVENTION", "FIELD OF INVENTION"],
                    ["BACKGROUND", "SUMMARY", "BRIEF DESCRIPTION"])
            if !data["background"]
                data["background"] := ExtractSubsection(fullText,
                    ["BACKGROUND"],
                    ["SUMMARY", "BRIEF DESCRIPTION", "DETAILED DESCRIPTION"])
            if !data["brief_description_of_drawings"]
                data["brief_description_of_drawings"] := ExtractSubsection(fullText,
                    ["BRIEF DESCRIPTION OF THE DRAWINGS", "BRIEF DESCRIPTION OF DRAWINGS"],
                    ["DETAILED DESCRIPTION", "DESCRIPTION OF THE PREFERRED"])
            if !data["detailed_description"]
                data["detailed_description"] := ExtractSubsection(fullText,
                    ["DETAILED DESCRIPTION", "DETAILED DESCRIPTION OF THE INVENTION",
                     "DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS",
                     "DESCRIPTION OF THE PREFERRED EMBODIMENTS"],
                    ["CLAIMS", "What is claimed is:", "What is claimed:"])
            if !data["claims"]
                data["claims"] := ExtractSubsection(fullText,
                    ["Claims"],
                    ["Description", "Referenced by", "Patent Citations"])
        }
    }

    return data
}

; ── DOM helper: find a heading by text and return the next sibling's text ───────

DOMHeadingSection(doc, headingPattern, *) {
    try {
        for h in doc.querySelectorAll("h1,h2,h3,h4") {
            if RegExMatch(Trim(h.innerText), "i)^\s*" headingPattern "\s*$") {
                sib := h.nextElementSibling
                if sib
                    return CleanText(sib.innerText)
            }
        }
    }
    return ""
}

; ── Text cleaning ───────────────────────────────────────────────────────────────

CleanText(text) {
    ; Rejoin inline reference numbers that were split across lines
    text := RegExReplace(text, "[ \t]*\n+[ \t]*((?:FIG\.\s*)?\d+[A-Z]?[a-z]?)\s*\n+[ \t]*", " $1 ")
    text := RegExReplace(text, "[ \t]*\n+[ \t]*(\d+[A-Z]?[a-z]?)[ \t]*\n+", " $1`n")
    text := RegExReplace(text, "[ \t]+", " ")          ; collapse spaces / tabs
    text := RegExReplace(text, "\n{3,}", "`n`n")        ; max two consecutive newlines
    text := RegExReplace(text, " *\n *", "`n")          ; trim spaces around newlines
    text := RegExReplace(text, " +([,;:.)\]])", "$1")   ; remove space before punctuation
    return Trim(text)
}

; ── Section extraction ──────────────────────────────────────────────────────────

; Find text between a start heading and the next stop heading.
ExtractSubsection(text, startHeadings, stopHeadings) {
    lines    := StrSplit(text, "`n")
    startIdx := 0

    Loop lines.Length {
        i    := A_Index
        line := Trim(lines[i])

        if !startIdx {
            for heading in startHeadings {
                if RegExMatch(line, "i)^\s*" ReEscape(heading) "\s*$") {
                    startIdx := i + 1
                    break
                }
            }
        } else {
            for heading in stopHeadings {
                if RegExMatch(line, "i)^\s*" ReEscape(heading)) {
                    collected := ""
                    Loop i - startIdx
                        collected .= lines[startIdx + A_Index - 1] "`n"
                    return CleanText(collected)
                }
            }
        }
    }

    if startIdx {
        collected := ""
        Loop lines.Length - startIdx + 1
            collected .= lines[startIdx + A_Index - 1] "`n"
        return CleanText(collected)
    }
    return ""
}

ReEscape(str) {
    return RegExReplace(str, "[.*+?^${}()|[\]\\]", "\$0")
}

; ── Output builder ──────────────────────────────────────────────────────────────

BuildOutput(data) {
    pid := data["patent_id"] ? data["patent_id"] : "Unknown"
    txt := (data["title"] ? data["title"] : pid) "`n"
    txt .= "Patent ID: " pid "`n`n"

    sections := [
        ["ABSTRACT",                        data["abstract"]],
        ["FIELD OF INVENTION",              data["field_of_invention"]],
        ["BACKGROUND",                      data["background"]],
        ["BRIEF DESCRIPTION OF DRAWINGS",   data["brief_description_of_drawings"]],
        ["DETAILED DESCRIPTION",            data["detailed_description"]],
        ["CLAIMS",                          data["claims"]],
    ]

    for sec in sections {
        txt .= sec[1] "`n`n"
        txt .= (sec[2] ? sec[2] : "Section not found in the patent document.") "`n`n"
    }

    return txt
}
