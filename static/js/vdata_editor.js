// static/js/vdata_editor.js
// Standalone Deadlock VDATA editor UI + Monaco wiring

(function () {
    // --- Settings & state ----------------------------------------------------

    const SETTINGS_KEY = "vdata_editor_settings_v2";
    const SETTINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    const DEFAULT_SETTINGS = {
        themePreset: "deadlock",       // deadlock | midnight | light
        editorTheme: "vs-dark",        // Monaco theme id
        accent: "#58a6ff",
        fontSize: 13,
        wrap: true,
        sidePanelWidth: 340,
        ts: Date.now()
    };

    let settings = loadSettings();

    let editor = null;
    let currentFileName = "untitled.vdata";
    let isDirty = false;

    let currentSchemaName = null;
    let lastOutline = [];
    let outlineUpdateTimer = null;

    // DOM references
    const statusFileEl = document.getElementById("status-file");
    const statusDirtyEl = document.getElementById("status-dirty");
    const statusPosEl = document.getElementById("status-position");

    const fileInput = document.getElementById("file-input");
    const newFileBtn = document.getElementById("new-file-btn");
    const downloadBtn = document.getElementById("download-btn");
    const toggleWrapBtn = document.getElementById("toggle-wrap-btn");
    const toggleDocsBtn = document.getElementById("toggle-docs-btn");

    const searchInput = document.getElementById("search-input");
    const searchNextBtn = document.getElementById("search-next-btn");

    const sidePanel = document.getElementById("side-panel");
    const rightResizer = document.getElementById("right-resizer");

    const tabOutline = document.getElementById("tab-outline");
    const tabDocs = document.getElementById("tab-docs");
    const panelOutline = document.getElementById("panel-outline");
    const panelDocs = document.getElementById("panel-docs");
    const outlineList = document.getElementById("outline-list");

    const jumpPanel = document.getElementById("jump-panel");
    const jumpList = document.getElementById("jump-list");

    const docsEmpty = document.getElementById("docs-empty");
    const docsActive = document.getElementById("docs-active");
    const docsSchemaNameEl = document.getElementById("docs-schema-name");
    const docsOpenLinkEl = document.getElementById("docs-open-link");
    const docsIframeEl = document.getElementById("docs-iframe");

    const themeButton = document.getElementById("theme-button");
    const themePanel = document.getElementById("theme-panel");
    const themePanelClose = document.getElementById("theme-panel-close");
    const themePresetSelect = document.getElementById("theme-preset-select");
    const accentColorInput = document.getElementById("accent-color-input");
    const fontSizeInput = document.getElementById("font-size-input");
    const fontSizeLabel = document.getElementById("font-size-label");
    const themeResetBtn = document.getElementById("theme-reset-btn");

    // --- Safe check for Monaco loader ---------------------------------------

    if (!window.require) {
        console.error("Monaco loader is not available. Check network / CDN.");
        return;
    }

    window.require.config({
        paths: {
            vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs"
        }
    });

    window.require(["vs/editor/editor.main"], function () {
        setupLanguage();
        createEditor();
        applySettingsToDocument();
        setupUIHandlers();
        restoreLastSchemaFromLocal();
    });

    // --- Settings helpers ----------------------------------------------------

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return { ...DEFAULT_SETTINGS };
            const parsed = JSON.parse(raw);
            if (!parsed.ts || Date.now() - parsed.ts > SETTINGS_TTL_MS) {
                return { ...DEFAULT_SETTINGS };
            }
            return { ...DEFAULT_SETTINGS, ...parsed };
        } catch (e) {
            console.warn("Failed to load settings, using defaults", e);
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        try {
            settings.ts = Date.now();
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn("Failed to save settings", e);
        }
    }

    function applySettingsToDocument() {
        // Accent
        setAccent(settings.accent);

        // Side panel width
        if (sidePanel && !sidePanel.classList.contains("side-panel--hidden")) {
            const w = Math.max(240, Math.min(480, settings.sidePanelWidth || 340));
            sidePanel.style.width = w + "px";
        }

        // Theme panel initial fields
        if (themePresetSelect) {
            themePresetSelect.value = settings.themePreset || "deadlock";
        }
        if (accentColorInput) {
            accentColorInput.value = settings.accent || DEFAULT_SETTINGS.accent;
        }
        if (fontSizeInput && fontSizeLabel) {
            fontSizeInput.value = String(settings.fontSize || DEFAULT_SETTINGS.fontSize);
            fontSizeLabel.textContent = String(settings.fontSize || DEFAULT_SETTINGS.fontSize);
        }
    }

    function setAccent(hex) {
        if (!hex) return;
        document.documentElement.style.setProperty("--accent", hex);
        document.documentElement.style.setProperty("--accent-soft", hexToSoft(hex, 0.18));
        document.documentElement.style.setProperty("--accent-strong", hexToSoft(hex, 0.6));
    }

    // Basic helper to produce rgba-ish values for CSS vars
    function hexToSoft(hex, alpha) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(88,166,255,${alpha})`;
        const r = parseInt(m[1], 16);
        const g = parseInt(m[2], 16);
        const b = parseInt(m[3], 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function applyEditorThemeFromPreset() {
        const preset = settings.themePreset || "deadlock";
        let themeId = "vs-dark";

        if (preset === "light") {
            themeId = "vs";
        } else if (preset === "midnight") {
            themeId = "vs-dark"; // still dark, just a different accent
        } else {
            themeId = "vs-dark";
        }

        settings.editorTheme = themeId;
        if (window.monaco && monaco.editor) {
            monaco.editor.setTheme(themeId);
            if (editor) {
                editor.updateOptions({
                    fontSize: settings.fontSize || DEFAULT_SETTINGS.fontSize,
                    wordWrap: settings.wrap ? "on" : "off"
                });
            }
        }
    }

    // --- Language setup (vdata) ---------------------------------------------

    function setupLanguage() {
        monaco.languages.register({ id: "vdata" });

        monaco.languages.setMonarchTokensProvider("vdata", {
            defaultToken: "",
            tokenPostfix: ".vdata",

            brackets: [
                { open: "{", close: "}", token: "delimiter.brace" },
                { open: "[", close: "]", token: "delimiter.bracket" },
                { open: "(", close: ")", token: "delimiter.parenthesis" },
                { open: "<", close: ">", token: "delimiter.angle" }
            ],

            keywords: [
                "_class", "_class_name", "_classid", "_class_name_map",
                "true", "false"
            ],

            tokenizer: {
                root: [
                    [/\/\/.*$/, "comment"],
                    [/#.*$/, "comment"],

                    [/"([^"\\]|\\.)*$/, "string.invalid"],
                    [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

                    [/\b\d+\.\d+([eE][\-+]?\d+)?\b/, "number.float"],
                    [/\b\d+\b/, "number"],

                    [/[a-zA-Z_][\w\.]*/, {
                        cases: {
                            "@keywords": "keyword",
                            "@default": "identifier"
                        }
                    }],

                    [/=/, "operator"],
                    [/[ \t\r\n]+/, "white"],
                    [/[{}()\[\]<>]/, "@brackets"],
                    [/[,:]/, "delimiter"]
                ],

                string: [
                    [/[^\\"]+/, "string"],
                    [/\\./, "string.escape"],
                    [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }]
                ]
            }
        });

        // Optional: folding rules so any braces are foldable
        monaco.languages.registerFoldingRangeProvider("vdata", {
            provideFoldingRanges(model) {
                const ranges = [];
                const stack = [];
                const lines = model.getLineCount();

                for (let line = 1; line <= lines; line++) {
                    const text = model.getLineContent(line);
                    for (let i = 0; i < text.length; i++) {
                        const ch = text[i];
                        if (ch === '{' || ch === '[' || ch === '(' || ch === '<') {
                            stack.push({ ch, line });
                        } else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') {
                            if (stack.length > 0) {
                                const open = stack.pop();
                                if (open.line < line) {
                                    ranges.push({
                                        start: open.line,
                                        end: line,
                                        kind: monaco.languages.FoldingRangeKind.Region
                                    });
                                }
                            }
                        }
                    }
                }

                return ranges;
            }
        });
    }

    // --- Editor setup --------------------------------------------------------

    function createEditor() {
        const container = document.getElementById("editor-container");
        if (!container) return;

        editor = monaco.editor.create(container, {
            value: [
                "// Deadlock VDATA Editor",
                "// Open a .vdata file or paste KV3 content to begin.",
                "",
                "{",
                "\t_class = \"CitadelAbilityVData\"",
                "\t// ...",
                "}"
            ].join("\n"),
            language: "vdata",
            theme: settings.editorTheme || "vs-dark",
            automaticLayout: true,
            fontLigatures: true,
            fontFamily: "JetBrains Mono, Fira Code, Consolas, 'Courier New', monospace",
            fontSize: settings.fontSize || DEFAULT_SETTINGS.fontSize,
            minimap: { enabled: true },
            lineNumbers: "on",
            wordWrap: settings.wrap ? "on" : "off",
            autoClosingBrackets: "always",
            autoClosingQuotes: "always",
            matchBrackets: "always",
            renderWhitespace: "selection",
            smoothScrolling: true,
            scrollBeyondLastLine: false,
            tabSize: 4,
            insertSpaces: true
        });

        editor.focus();
        applyEditorThemeFromPreset();

        editor.onDidChangeModelContent(function () {
            setDirty(true);
            scheduleOutlineUpdate();
        });

        editor.onDidChangeCursorPosition(function (e) {
            updateCursorStatus(e.position);
            updateActiveOutlineFromCursor(e.position);
            updateSchemaFromCursor(e.position);
        });

        editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            function () {
                triggerDownload();
            }
        );

        editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
            function () {
                editor.getAction("actions.find").run();
            }
        );

        updateCursorStatus({ lineNumber: 1, column: 1 });
        updateFileStatus();
        scheduleOutlineUpdate();
    }

    // --- UI handlers ---------------------------------------------------------

    function setupUIHandlers() {
        // File open
        if (fileInput) {
            fileInput.addEventListener("change", function (evt) {
                const file = evt.target.files && evt.target.files[0];
                if (!file) return;
                currentFileName = file.name || "untitled.vdata";
                updateFileStatus();

                const reader = new FileReader();
                reader.onload = function (e) {
                    if (!editor) return;
                    const text = e.target.result || "";
                    editor.setValue(String(text));
                    editor.setScrollTop(0);
                    editor.setScrollLeft(0);
                    setDirty(false);
                    scheduleOutlineUpdate();
                };
                reader.readAsText(file);
            });
        }

        // New file
        if (newFileBtn) {
            newFileBtn.addEventListener("click", function () {
                if (!editor) return;
                editor.setValue([
                    "// New Deadlock VDATA",
                    "",
                    "{",
                    "\t_class = \"CitadelAbilityVData\"",
                    "\t// ...",
                    "}"
                ].join("\n"));
                currentFileName = "untitled.vdata";
                setDirty(false);
                updateFileStatus();
                scheduleOutlineUpdate();
            });
        }

        // Download
        if (downloadBtn) {
            downloadBtn.addEventListener("click", function () {
                triggerDownload();
            });
        }

        // Wrap toggle
        if (toggleWrapBtn) {
            toggleWrapBtn.addEventListener("click", function () {
                settings.wrap = !settings.wrap;
                saveSettings();
                if (editor) {
                    editor.updateOptions({ wordWrap: settings.wrap ? "on" : "off" });
                }
            });
        }

        // Toggle side panel (Outline/Docs)
        if (toggleDocsBtn) {
            toggleDocsBtn.addEventListener("click", function () {
                if (!sidePanel) return;
                const hidden = sidePanel.classList.contains("side-panel--hidden");
                if (hidden) {
                    sidePanel.classList.remove("side-panel--hidden");
                    const w = Math.max(240, Math.min(480, settings.sidePanelWidth || 340));
                    sidePanel.style.width = w + "px";
                } else {
                    sidePanel.classList.add("side-panel--hidden");
                }
            });
        }

        // Search
        if (searchNextBtn) {
            searchNextBtn.addEventListener("click", runSearchJump);
        }
        if (searchInput) {
            searchInput.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    runSearchJump();
                }
            });
        }

        // Tabs
        if (tabOutline) {
            tabOutline.addEventListener("click", function () {
                setSideTab("outline");
            });
        }
        if (tabDocs) {
            tabDocs.addEventListener("click", function () {
                setSideTab("docs");
            });
        }

        // Theme panel
        if (themeButton && themePanel) {
            themeButton.addEventListener("click", function () {
                themePanel.classList.remove("theme-panel--hidden");
            });
        }
        if (themePanelClose && themePanel) {
            themePanelClose.addEventListener("click", function () {
                themePanel.classList.add("theme-panel--hidden");
            });
        }

        // Theme preset
        if (themePresetSelect) {
            themePresetSelect.addEventListener("change", function () {
                settings.themePreset = this.value || "deadlock";
                saveSettings();
                applyEditorThemeFromPreset();
            });
        }

        // Accent colour
        if (accentColorInput) {
            accentColorInput.addEventListener("input", function () {
                settings.accent = this.value || DEFAULT_SETTINGS.accent;
                saveSettings();
                setAccent(settings.accent);
            });
        }

        // Font size
        if (fontSizeInput && fontSizeLabel) {
            fontSizeInput.addEventListener("input", function () {
                const size = parseInt(this.value, 10) || DEFAULT_SETTINGS.fontSize;
                settings.fontSize = size;
                fontSizeLabel.textContent = String(size);
                saveSettings();
                if (editor) {
                    editor.updateOptions({ fontSize: size });
                }
            });
        }

        // Reset theme/layout
        if (themeResetBtn) {
            themeResetBtn.addEventListener("click", function () {
                try {
                    localStorage.removeItem(SETTINGS_KEY);
                } catch (e) {}
                location.reload();
            });
        }

        // Resizing side panel
        if (rightResizer && sidePanel) {
            let isResizing = false;

            rightResizer.addEventListener("mousedown", function (e) {
                e.preventDefault();
                isResizing = true;
                document.body.classList.add("resizing");
            });

            window.addEventListener("mousemove", function (e) {
                if (!isResizing) return;
                const main = document.querySelector(".vdata-main");
                if (!main) return;
                const rect = main.getBoundingClientRect();
                const totalWidth = rect.width;
                const offsetX = e.clientX - rect.left;
                let newWidth = totalWidth - offsetX;
                newWidth = Math.max(240, Math.min(480, newWidth));
                sidePanel.style.width = newWidth + "px";
                settings.sidePanelWidth = newWidth;
            });

            window.addEventListener("mouseup", function () {
                if (!isResizing) return;
                isResizing = false;
                document.body.classList.remove("resizing");
                saveSettings();
            });
        }

        // Global Ctrl+O to open file
        window.addEventListener("keydown", function (e) {
            if (e.key === "o" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (fileInput) fileInput.click();
            }
        });
    }

    // --- Status helpers ------------------------------------------------------

    function setDirty(dirty) {
        isDirty = dirty;
        if (!statusDirtyEl) return;

        if (dirty) {
            statusDirtyEl.textContent = "● Modified";
            statusDirtyEl.classList.remove("status-dirty--clean");
            statusDirtyEl.classList.add("status-dirty--dirty");
        } else {
            statusDirtyEl.textContent = "● Saved";
            statusDirtyEl.classList.remove("status-dirty--dirty");
            statusDirtyEl.classList.add("status-dirty--clean");
        }
    }

    function updateFileStatus() {
        if (!statusFileEl) return;
        statusFileEl.textContent = currentFileName || "untitled.vdata";
    }

    function updateCursorStatus(pos) {
        if (!statusPosEl) return;
        statusPosEl.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
    }

    function triggerDownload() {
        if (!editor) return;
        const text = editor.getValue();
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = currentFileName || "untitled.vdata";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
        setDirty(false);
    }

    // --- Search --------------------------------------------------------------

    function runSearchJump() {
        if (!editor || !searchInput) return;
        const term = searchInput.value;
        if (!term) return;

        const model = editor.getModel();
        if (!model) return;

        const matches = model.findMatches(
            term,
            true,
            false,
            false,
            null,
            true
        );

        if (!matches || matches.length === 0) {
            return;
        }

        const pos = editor.getPosition();
        let nextMatch = matches[0];

        for (let i = 0; i < matches.length; i++) {
            const range = matches[i].range;
            if (
                range.startLineNumber > pos.lineNumber ||
                (range.startLineNumber === pos.lineNumber &&
                    range.startColumn > pos.column)
            ) {
                nextMatch = matches[i];
                break;
            }
        }

        editor.setSelection(nextMatch.range);
        editor.revealRangeInCenter(nextMatch.range);
        editor.focus();
    }

    // --- Side tabs -----------------------------------------------------------

    function setSideTab(tab) {
        if (!tabOutline || !tabDocs || !panelOutline || !panelDocs) return;

        if (tab === "outline") {
            tabOutline.classList.add("side-tab--active");
            tabDocs.classList.remove("side-tab--active");
            panelOutline.classList.add("side-panel-content--active");
            panelDocs.classList.remove("side-panel-content--active");
        } else {
            tabDocs.classList.add("side-tab--active");
            tabOutline.classList.remove("side-tab--active");
            panelDocs.classList.add("side-panel-content--active");
            panelOutline.classList.remove("side-panel-content--active");
        }
    }

    // --- Outline & jump list -------------------------------------------------

    function scheduleOutlineUpdate() {
        if (outlineUpdateTimer) {
            clearTimeout(outlineUpdateTimer);
        }
        outlineUpdateTimer = setTimeout(buildOutline, 300);
    }

    function buildOutline() {
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        const text = model.getValue();
        const lines = text.split(/\r?\n/);
        const outline = [];

        let braceLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineNumber = i + 1;
            const line = lines[i];

            // Adjust brace level
            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                if (ch === '{' || ch === '[' || ch === '(' || ch === '<') {
                    braceLevel++;
                } else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') {
                    braceLevel = Math.max(0, braceLevel - 1);
                }
            }

            const keyMatch = line.match(/^\s*([A-Za-z_][\w\.]*)\s*=/);
            const classMatch = line.match(/_class\s*=\s*"([^"]+)"/);

            if (classMatch) {
                outline.push({
                    label: `_class = ${classMatch[1]}`,
                    shortLabel: classMatch[1],
                    line: lineNumber,
                    depth: 0
                });
            } else if (keyMatch) {
                const key = keyMatch[1];
                const depth = Math.min(braceLevel, 2);
                outline.push({
                    label: key,
                    shortLabel: key,
                    line: lineNumber,
                    depth
                });
            }
        }

        lastOutline = outline;
        renderOutline(outline);
        renderJumpList(outline);
    }

    function renderOutline(outline) {
        if (!outlineList) return;
        outlineList.innerHTML = "";

        outline.forEach((item, idx) => {
            const li = document.createElement("li");
            li.classList.add("outline-item");
            li.classList.add(`outline-item-depth-${item.depth}`);
            li.dataset.index = String(idx);

            const labelSpan = document.createElement("span");
            labelSpan.textContent = item.label;

            li.appendChild(labelSpan);
            li.addEventListener("click", function () {
                jumpToLine(item.line);
            });

            outlineList.appendChild(li);
        });
    }

    function renderJumpList(outline) {
        if (!jumpList) return;
        jumpList.innerHTML = "";

        const forJump = outline.filter(o => o.depth <= 1);

        forJump.forEach((item, idx) => {
            const li = document.createElement("li");
            li.classList.add("jump-item");
            li.classList.add(`jump-item-depth-${item.depth}`);
            li.dataset.index = String(idx);

            const labelSpan = document.createElement("span");
            labelSpan.textContent = item.shortLabel || item.label;

            li.appendChild(labelSpan);
            li.addEventListener("click", function () {
                jumpToLine(item.line);
            });

            jumpList.appendChild(li);
        });
    }

    function updateActiveOutlineFromCursor(pos) {
        if (!lastOutline || lastOutline.length === 0) return;

        let bestIndex = -1;
        for (let i = 0; i < lastOutline.length; i++) {
            if (lastOutline[i].line <= pos.lineNumber) {
                bestIndex = i;
            } else {
                break;
            }
        }

        const idx = bestIndex;
        const outlineItems = outlineList ? outlineList.querySelectorAll(".outline-item") : [];
        outlineItems.forEach((li, i) => {
            if (i === idx) {
                li.classList.add("outline-item--active");
            } else {
                li.classList.remove("outline-item--active");
            }
        });

        const jumpItems = jumpList ? jumpList.querySelectorAll(".jump-item") : [];
        jumpItems.forEach(li => li.classList.remove("jump-item--active"));
        if (idx >= 0 && idx < lastOutline.length) {
            const targetLabel = lastOutline[idx].shortLabel;
            jumpItems.forEach(li => {
                if (li.textContent === targetLabel) {
                    li.classList.add("jump-item--active");
                }
            });
        }
    }

    function jumpToLine(lineNumber) {
        if (!editor) return;
        const pos = { lineNumber, column: 1 };
        editor.setPosition(pos);
        editor.revealLineInCenter(lineNumber);
        editor.focus();
    }

    // --- Schema docs: auto from cursor --------------------------------------

    const LAST_SCHEMA_KEY = "vdata_editor_last_schema";

    function updateSchemaFromCursor(pos) {
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        const lineText = model.getLineContent(pos.lineNumber);

        // Try to grab a schema-like name from the line
        let schemaName = null;

        // 1) _class = "Name"
        const classMatch = lineText.match(/_class\s*=\s*"([^"]+)"/);
        if (classMatch) {
            schemaName = classMatch[1];
        }

        // 2) Anything like CitadelAbilityVData or CAbility_*_VData
        if (!schemaName) {
            const genericMatch = lineText.match(/"([^"]+)"/);
            if (genericMatch) {
                const candidate = genericMatch[1];
                if (
                    candidate.endsWith("VData") ||
                    candidate.startsWith("CAbility_") ||
                    candidate.includes("CitadelAbility")
                ) {
                    schemaName = candidate;
                }
            }
        }

        if (!schemaName) return;
        if (schemaName === currentSchemaName) return;

        currentSchemaName = schemaName;
        setSchemaDocs(schemaName);
        persistLastSchema(schemaName);
    }

    function setSchemaDocs(schemaName) {
        if (!docsEmpty || !docsActive || !docsSchemaNameEl || !docsOpenLinkEl || !docsIframeEl) return;

        const baseUrl = "https://deadlockmodding.pages.dev/schemas/client/";
        const fullUrl = baseUrl + encodeURIComponent(schemaName);

        docsSchemaNameEl.textContent = schemaName;
        docsOpenLinkEl.href = fullUrl;
        docsIframeEl.src = fullUrl;

        docsEmpty.style.display = "none";
        docsActive.classList.remove("docs-active--hidden");

        // Ensure side panel is visible and docs tab selected
        if (sidePanel && sidePanel.classList.contains("side-panel--hidden")) {
            sidePanel.classList.remove("side-panel--hidden");
            const w = Math.max(240, Math.min(480, settings.sidePanelWidth || 340));
            sidePanel.style.width = w + "px";
        }
        setSideTab("docs");
    }

    function persistLastSchema(schemaName) {
        try {
            const payload = { name: schemaName, ts: Date.now() };
            localStorage.setItem(LAST_SCHEMA_KEY, JSON.stringify(payload));
        } catch (e) {
            // ignore
        }
    }

    function restoreLastSchemaFromLocal() {
        try {
            const raw = localStorage.getItem(LAST_SCHEMA_KEY);
            if (!raw) return;
            const payload = JSON.parse(raw);
            if (!payload.name || !payload.ts) return;
            if (Date.now() - payload.ts > SETTINGS_TTL_MS) return;

            currentSchemaName = payload.name;
            setSchemaDocs(payload.name);
        } catch (e) {
            // ignore
        }
    }

})();
