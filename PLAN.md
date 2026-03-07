# Envisiage — Technical Build Plan

**Project:** Envisiage — An inline commenting tutor that breaks down coding problems using AI annotations anchored directly to code, moving past the traditional sidebar chatbox paradigm.

**Stack:** SvelteKit, Monaco Editor, Anthropic Claude API, TypeScript

**Design Language:** Minimal greyscale light mode. AI interactions introduce teal/green hues as visual signals — annotations glow, highlights tint, active threads pulse. The interface should feel like a calm, focused reading environment that comes alive when you engage with it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  SvelteKit App                   │
│                                                  │
│  ┌───────────────────────┐  ┌────────────────┐  │
│  │    Monaco Editor       │  │  Annotation    │  │
│  │    (code surface)      │◄─┤  Overlay Layer │  │
│  │                        │  │  (positioned   │  │
│  │  - syntax highlighting │  │   inline)      │  │
│  │  - selection tracking  │  └───────┬────────┘  │
│  │  - gutter decorations  │          │           │
│  └───────────┬───────────┘  ┌───────┴────────┐  │
│              │              │  Thread Panel   │  │
│              │              │  (follow-up     │  │
│              │              │   Q&A per       │  │
│              │              │   annotation)   │  │
│              │              └───────┬────────┘  │
│  ┌───────────┴──────────────────────┴────────┐  │
│  │           State Manager (Svelte stores)    │  │
│  │  - annotations[]                           │  │
│  │  - activeThread                            │  │
│  │  - selectionContext                        │  │
│  └───────────────────┬───────────────────────┘  │
│                      │                           │
│  ┌───────────────────┴───────────────────────┐  │
│  │         API Route: /api/explain            │  │
│  │  - receives code + selection range         │  │
│  │  - sends to Claude with tutor prompt       │  │
│  │  - streams response back                   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Design Tokens

Use these values consistently across all phases:

```
COLORS:
  --bg-primary:        #FAFAFA
  --bg-secondary:      #F2F2F2
  --bg-editor:         #FFFFFF
  --text-primary:      #1A1A1A
  --text-secondary:    #6B6B6B
  --text-muted:        #9B9B9B
  --border-default:    #E5E5E5
  --border-subtle:     #EFEFEF

  --ai-teal:           #0D9488
  --ai-teal-light:     #CCFBF1
  --ai-teal-muted:     #F0FDFA
  --ai-teal-glow:      rgba(13, 148, 136, 0.12)
  --ai-green:          #059669
  --ai-green-light:    #D1FAE5

TYPOGRAPHY:
  --font-ui:           'Inter', system-ui, sans-serif
  --font-mono:         'JetBrains Mono', 'Fira Code', monospace
  --font-size-sm:      13px
  --font-size-base:    14px
  --font-size-lg:      16px

SPACING:
  --space-xs:          4px
  --space-sm:          8px
  --space-md:          16px
  --space-lg:          24px
  --space-xl:          32px

ANIMATION:
  --ease-out:          cubic-bezier(0.16, 1, 0.3, 1)
  --duration-fast:     150ms
  --duration-normal:   250ms
  --duration-slow:     400ms
```

AI interaction visual rules:
- When a user selects code, the selection highlight uses `--ai-teal-glow` as a subtle background tint.
- Active annotations display a left-border accent in `--ai-teal`.
- While Claude is streaming a response, the annotation card pulses with a breathing glow using `--ai-teal-light`.
- Resolved/read annotations fade to `--text-muted` and `--border-subtle`.
- Gutter icons for annotated lines use `--ai-teal` fill.

---

## Phase 1 — Editor Foundation

**Goal:** Get a working SvelteKit app with Monaco Editor that can track text selections and display a basic overlay panel anchored to code lines.

### Tasks

1. Scaffold a SvelteKit project with TypeScript.
   ```bash
   npx sv create envisiage
   # Select: SvelteKit minimal, TypeScript, Tailwind (optional)
   ```

2. Install and mount Monaco Editor using the `monaco-editor` npm package. Wrap it in a Svelte component (`CodeEditor.svelte`) that:
   - Fills the viewport (full height, full width minus any side panel).
   - Uses a light theme with the greyscale tokens above.
   - Accepts a `code` prop (string) and a `language` prop (string, default `"javascript"`).
   - Exposes the editor instance via a Svelte store or component binding.

3. Create a custom Monaco theme registered via `monaco.editor.defineTheme()`:
   - Background: `#FFFFFF`
   - Default foreground: `#1A1A1A`
   - Selection highlight: `rgba(13, 148, 136, 0.12)` (the teal glow)
   - Line highlight: `#FAFAFA`
   - Gutter background matching editor background.

4. Track user text selections. Listen to `editor.onDidChangeCursorSelection` and store the current selection range (startLine, startCol, endLine, endCol) in a Svelte writable store (`selectionStore`).

5. Build a minimal `AnnotationOverlay.svelte` component:
   - Absolutely positioned relative to the editor container.
   - Given a line number, calculate its Y position using `editor.getTopForLineNumber(line)` and offset by the editor's scroll position.
   - Render a small card (white bg, `--border-default` border, `--ai-teal` left accent) to the right of the editor or as an inline widget.
   - The card should reposition on editor scroll (listen to `editor.onDidScrollChange`).

6. Add a trigger mechanism: when the user selects code and presses a keyboard shortcut (Cmd/Ctrl+Shift+E) or clicks a button that appears near the selection, it creates a placeholder annotation card anchored to that selection's start line.

### Checkpoint Test

- Open the app in a browser.
- Paste or type any code into the editor.
- Select a block of code.
- Trigger an annotation (keyboard shortcut or button).
- Confirm: a card appears next to the correct line. Scrolling the editor moves the card with it. Selecting a different block and triggering again creates a second card at the new position.

---

## Phase 2 — Claude API Integration

**Goal:** Connect the annotation trigger to the Claude API so selecting code and requesting an explanation returns a real AI-generated inline breakdown.

### Tasks

1. Create a SvelteKit server route at `src/routes/api/explain/+server.ts`:
   - Accepts POST with JSON body: `{ code: string, selection: string, fullContext: string, language: string }`.
   - `code` is the full editor content; `selection` is the highlighted substring; `fullContext` is the surrounding function/block for additional context; `language` is the detected/selected language.
   - Calls the Anthropic messages API (`@anthropic-ai/sdk` npm package) with a system prompt tuned for inline tutoring (see below).
   - Streams the response back using server-sent events or a ReadableStream.

2. System prompt for Claude (store in a constants file, iterate on this over time):
   ```
   You are Envisiage, an inline code tutor. The user has highlighted a specific
   section of code and wants to understand it. Your job is to break down the
   logic of ONLY the selected code as clearly and concisely as possible.

   Rules:
   - Explain what the selected code does, not the entire file.
   - Break complex logic into numbered micro-steps.
   - Use the surrounding context to inform your explanation but keep focus tight.
   - If the selection is a single expression, explain what it evaluates to and why.
   - If the selection is a block, explain the flow of control step by step.
   - Use plain language. Avoid jargon unless defining it.
   - Keep responses short — aim for 2-6 sentences for simple selections,
     up to a short paragraph with steps for complex ones.
   - Format: Use markdown. Use inline `code` references freely.
   - Never repeat the code back. The user can already see it.
   ```

3. Wire the annotation trigger (from Phase 1) to call this endpoint:
   - On trigger, extract the selected text, the full editor content, and the surrounding context (e.g., the enclosing function, or 10 lines above/below).
   - POST to `/api/explain`.
   - Stream the response into the annotation card, rendering markdown as it arrives.

4. Add a loading/streaming state to the annotation card:
   - While waiting: show a subtle pulsing border animation using `--ai-teal-light`.
   - As tokens stream in: render incrementally using a simple markdown renderer (e.g., `marked` or `svelte-markdown`).
   - On complete: border settles to static `--ai-teal` left accent.

5. Store the API key server-side via environment variable (`ANTHROPIC_API_KEY` in `.env`). Never expose it to the client.

### Checkpoint Test

- Select a piece of code (e.g., a `.map()` chain, a conditional block, or a function definition).
- Trigger an explanation.
- Confirm: the annotation card streams in an explanation that is specifically about the selected code, not generic. The explanation references the actual variable names and logic from the selection. The streaming animation works visually.
- Test edge cases: select a single variable name, select an entire file, select a comment. Verify the responses are appropriately scoped.

---

## Phase 3 — Annotation Management & Persistence

**Goal:** Support multiple annotations, dismiss/collapse them, and persist them in local state so they survive interactions within a session.

### Tasks

1. Define an `Annotation` type:
   ```typescript
   interface Annotation {
     id: string;
     selectionRange: {
       startLine: number;
       startCol: number;
       endLine: number;
       endCol: number;
     };
     selectedText: string;
     explanation: string;
     status: 'loading' | 'streaming' | 'complete' | 'collapsed';
     timestamp: number;
     thread: ThreadMessage[];
   }

   interface ThreadMessage {
     id: string;
     role: 'user' | 'assistant';
     content: string;
     timestamp: number;
   }
   ```

2. Create a Svelte store (`annotationsStore`) as a writable array of `Annotation` objects. All annotation CRUD flows through this store.

3. Implement annotation lifecycle UI:
   - **Active state:** Card is expanded, showing the full explanation with the teal left border.
   - **Collapsed state:** Card shrinks to a single-line summary (first sentence or a truncated preview) with a muted border. Click to expand.
   - **Dismiss:** An "×" button removes the annotation entirely.
   - **Gutter indicators:** For every annotation, add a Monaco decoration (a small teal dot or icon) in the gutter at the annotation's start line. Clicking the gutter icon expands/scrolls to that annotation.

4. Handle overlapping annotations: if two annotations cover the same or overlapping line ranges, stack their cards vertically with slight indentation or a small gap. Use z-indexing so the most recently active annotation is on top.

5. Highlight the associated code range when an annotation card is hovered or focused:
   - Use Monaco's `deltaDecorations` API to apply a background highlight (`--ai-teal-glow`) to the selection range of the hovered annotation.
   - Remove the highlight when the annotation loses focus.

6. Session persistence: serialize the annotations store to `sessionStorage` on change, and restore on mount. This is session-only (not permanent) for the experiment phase.

### Checkpoint Test

- Create 3-4 annotations on different parts of the code.
- Collapse one, dismiss another. Confirm the gutter icons update accordingly.
- Hover over an annotation card and confirm the corresponding code highlights in the editor.
- Refresh the page (session should restore). Navigate away and back (session should restore within the same tab).
- Scroll through code with many annotations — confirm cards track their lines correctly and don't overlap illegibly.

---

## Phase 4 — Threaded Follow-Up Conversations

**Goal:** Allow the user to ask follow-up questions within an annotation, creating a conversation thread anchored to that specific code selection.

### Tasks

1. Add a small input field at the bottom of each expanded annotation card. Placeholder text: *"Ask a follow-up..."* Styled with `--border-subtle` border, on focus transitions to `--ai-teal` border.

2. On submit, append the user's message to the annotation's `thread[]` array and POST to a new endpoint `src/routes/api/followup/+server.ts`:
   - Body includes: original `selectedText`, original `explanation`, the full `thread` history, and the new question.
   - The system prompt is extended:
     ```
     The user is asking a follow-up question about a specific code selection
     they already received an explanation for. Here is the context:

     Selected code: {selectedText}
     Original explanation: {explanation}
     Conversation so far: {thread}

     Continue helping them understand this code. Stay focused on the selected
     code and its immediate context. If they ask about something in a different
     part of the file, suggest they create a new annotation there instead.
     ```
   - Stream the assistant response back and append it to the thread.

3. Render the thread as a mini-conversation within the annotation card:
   - User messages: right-aligned, light grey background.
   - Assistant messages: left-aligned, white background with teal-left accent.
   - Keep the card scrollable if the thread grows long, with the input pinned at the bottom.

4. Add a visual indicator on collapsed annotations that have active threads (e.g., a small badge count showing the number of exchanges).

5. Add a "re-explain" action: a button within the annotation that re-sends the selected code to Claude with a modified prompt asking for an alternative explanation (different angle, simpler language, or more technical depth). This replaces the current explanation rather than adding to the thread.

### Checkpoint Test

- Create an annotation. Ask a follow-up question like "What would happen if this array were empty?"
- Confirm the response is contextually aware of both the code and the prior explanation.
- Ask 2-3 more follow-ups. Confirm the thread maintains coherence and stays focused on the selected code.
- Collapse the annotation and confirm the thread badge appears.
- Use "re-explain" and confirm the explanation replaces, not appends.

---

## Phase 5 — Granularity Controls & Smart Context

**Goal:** Let the user control the depth/style of explanations and give Claude smarter context about the surrounding code.

### Tasks

1. Add a granularity selector that appears on annotation trigger (before the API call). Options presented as small pill buttons:
   - **"ELI5"** — Explain like I'm a beginner. No assumed knowledge.
   - **"Step-through"** — Walk through the logic line by line, step by step.
   - **"Technical"** — Assume I know the language; explain the *why*, not the *what*.
   - **"Debug"** — I think something is wrong here. Help me find it.

   Each option modifies the system prompt sent to Claude accordingly.

2. Implement smart context extraction. When the user selects code, automatically determine:
   - The enclosing function/method/class (use simple heuristic: walk up from selection to find the nearest `function`, `class`, `def`, `=>`, or `{` that opens the current scope).
   - Imported modules or variables referenced in the selection but defined elsewhere in the file.
   - Package this as `contextAbove` and `contextBelow` (20 lines in each direction) plus `enclosingScope` and send it alongside the selection.

3. Add language auto-detection: use Monaco's built-in language detection or let the user toggle it via a dropdown in the top bar. Pass the detected language to the API so Claude can tailor its explanations (e.g., Python idioms vs JavaScript patterns).

4. Add a "scope visualizer": when the user hovers the granularity selector, briefly highlight in the editor what Claude will see as context (the enclosing scope, the 20-line window). This gives transparency into what the AI is working with.

### Checkpoint Test

- Select a `for` loop and request "ELI5" vs "Technical" explanations. Confirm they are meaningfully different in tone and depth.
- Select a line that references a variable defined 30 lines above. Confirm the explanation correctly references what that variable is (proving context extraction works).
- Select code in Python, then switch to JavaScript. Confirm language-appropriate explanations.
- Hover the granularity selector and confirm the context highlight appears in the editor.

---

## Phase 6 — Polish, Animations & UX Refinement

**Goal:** Elevate the experience from functional prototype to something that feels intentionally designed. This is where the "experiment on AI interactions" identity comes through.

### Tasks

1. Annotation entry animation: cards should slide in from the right (or fade-expand from the gutter) with a spring-based easing (`--ease-out`, ~300ms). Use Svelte's built-in `fly` or `slide` transitions.

2. Streaming text animation: as Claude's response streams in, each word should appear with a very subtle fade-in (opacity 0→1 over 100ms). Not typewriter-style character-by-character — word-by-word with a soft entrance.

3. Code highlight transitions: when hovering an annotation, the code highlight should fade in (not snap), using a 150ms opacity transition.

4. Teal "energy" indicator: while an explanation is streaming, add a thin animated gradient bar at the top of the annotation card that shimmers from left to right in `--ai-teal-light` to `--ai-teal`. Stops and fades when streaming completes.

5. Empty state: when no annotations exist, show a centered, muted message in the annotation panel area: *"Select code and press ⌘⇧E to start understanding."* Style in `--text-muted`, `--font-size-sm`.

6. Responsive layout:
   - Desktop (>1200px): Editor takes ~65% width, annotation panel takes ~35% as a right sidebar.
   - Tablet (768-1200px): Annotations appear as a bottom sheet (40% height) with the editor above.
   - Mobile (<768px): Full-screen editor with annotations as a swipeable overlay.

7. Keyboard shortcuts:
   - `Cmd/Ctrl + Shift + E` — Trigger annotation on selection.
   - `Escape` — Collapse active annotation.
   - `Cmd/Ctrl + Shift + A` — Toggle annotation panel visibility.

8. Top bar: minimal. Contains only:
   - "envisiage" wordmark in `--text-secondary`, lowercase, `--font-ui` weight 500.
   - Language selector dropdown (small, grey, unobtrusive).
   - A small `?` icon that opens a brief onboarding tooltip.

### Checkpoint Test

- Walk through the full flow: open the app, paste code, select a block, trigger annotation, watch it stream in, ask a follow-up, collapse it, trigger another, scroll around.
- The entire experience should feel smooth and intentional. No layout jumps, no janky repositioning, no flash of unstyled content.
- Test on a narrow viewport. Confirm the responsive layouts work.
- Test keyboard-only navigation. Confirm all core actions are accessible without a mouse.

---

## File Structure

```
envisiage/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── CodeEditor.svelte          # Monaco wrapper
│   │   │   ├── AnnotationOverlay.svelte   # Positioned annotation layer
│   │   │   ├── AnnotationCard.svelte      # Individual annotation card
│   │   │   ├── ThreadMessage.svelte       # Single message in a thread
│   │   │   ├── GranularityPicker.svelte   # ELI5/Step/Technical/Debug pills
│   │   │   ├── TopBar.svelte              # Minimal header
│   │   │   └── EmptyState.svelte          # No-annotations placeholder
│   │   ├── stores/
│   │   │   ├── annotations.ts             # Annotation CRUD store
│   │   │   ├── editor.ts                  # Editor instance & selection store
│   │   │   └── ui.ts                      # Panel visibility, active states
│   │   ├── utils/
│   │   │   ├── context.ts                 # Smart context extraction
│   │   │   ├── markdown.ts                # Markdown rendering helper
│   │   │   └── positioning.ts             # Annotation Y-position calculation
│   │   ├── prompts/
│   │   │   ├── explain.ts                 # Base explanation system prompt
│   │   │   ├── followup.ts                # Follow-up system prompt
│   │   │   └── granularity.ts             # Prompt modifiers per granularity
│   │   └── types.ts                       # Annotation, Thread, etc.
│   ├── routes/
│   │   ├── +page.svelte                   # Main app page
│   │   ├── +layout.svelte                 # App shell, top bar
│   │   └── api/
│   │       ├── explain/+server.ts         # Claude explanation endpoint
│   │       └── followup/+server.ts        # Claude follow-up endpoint
│   └── app.css                            # Design tokens, global styles
├── static/
├── .env                                   # ANTHROPIC_API_KEY
├── svelte.config.js
├── package.json
└── tsconfig.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "monaco-editor": "^0.50.0",
    "marked": "^12.0.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/kit": "latest",
    "svelte": "latest",
    "typescript": "latest",
    "vite": "latest"
  }
}
```

Note on Monaco + SvelteKit: Monaco must be loaded client-side only (it accesses `window`). Use a dynamic import inside `onMount` or wrap the component with Svelte's `{#if browser}` check from `$app/environment`. The `monaco-editor` workers need to be configured via Vite — use `vite-plugin-monaco-editor` or manually configure the worker paths in `vite.config.ts`.

---

## What This Plan Does NOT Cover (Future Phases)

These are explicitly out of scope for the initial build but noted for future iteration:

- **Multi-file support.** The current design assumes a single file in the editor. Supporting project-level context (imports from other files, multi-file navigation) is a meaningful expansion.
- **Persistent storage / user accounts.** Annotations are session-only. A backend (database, auth) for saving annotation history across sessions is a separate effort.
- **Collaborative annotations.** Multiple users annotating the same code, Google Docs–style. Requires real-time sync (WebSocket/CRDT).
- **Code execution.** Running the code and correlating runtime state with annotations (combining Python Tutor's approach with Envisiage's).
- **VS Code extension.** Porting the annotation UX into a VS Code extension to meet developers where they already work.
- **Custom model selection.** Letting users choose between Claude models or other providers.