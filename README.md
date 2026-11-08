# Hoot, the study pet

Hoot is an owl that sits on top of your windows while you study. Ask it about whatever is on your screen, such as a quiz question, a PDF page, a slide or some code. It takes a screenshot of that display and answers in a speech bubble.

- **Ask:** press **⌥Space** from any app, or click Hoot. Type your question and press Enter (Shift+Enter adds a new line). Esc closes the bubble.
- **What it sees:** a fresh screenshot of your screen each time you ask, so follow-ups ("and question 6?") see the page as it is now.
  - With the shortcut, it captures the display your mouse is on. When you click Hoot, it captures the display Hoot is on.
  - Hoot and its bubble are left out of the screenshot.
  - A thumbnail of each screenshot shows in the chat, so you can see what it looked at.
  - Untick **Look at my screen** to ask without a screenshot.
- **Conversation:** Hoot remembers the conversation until you press **New chat**, change the model, or quit.
- **Moving it:** drag Hoot to move it. Right-click it to hide it for 30 minutes or to quit. Hoot's eyes follow your cursor while it moves.
- **Menu bar 🦉:**
  - Model: Sonnet is the default, Opus is the smartest, Haiku is the fastest.
  - Shortcut: ⌥Space, ⌃⌥Space or ⌥⇧Space.
  - Also: start at login, reset position, and Screen Recording settings.

## Run it

```
npm install
npm start
```

You need:
- **Claude Code**, signed in with your Claude account. If `claude` works in Terminal, Hoot works. Hoot runs `claude -p` in the background, so questions use your Claude subscription. Any `ANTHROPIC_API_KEY` is removed from its environment, so it never bills an API key instead.
- **Screen Recording permission.** The first time you ask, macOS asks you to allow it. Turn it on for **Electron** in System Settings › Privacy & Security › Screen & System Audio Recording, then quit Hoot (🦉 › Quit Hoot) and run `npm start` again.

If ⌥Space is already used by another app (the ChatGPT app uses it by default), Hoot picks the next free shortcut. The 🦉 menu shows which one is active.

## Privacy and safety

- Screenshots are taken only when you ask a question. They go to Claude through Claude Code and are not saved to disk.
- Claude runs with **no tools**, `--safe-mode` (none of your CLAUDE.md, hooks, plugins or MCP servers) and no session saved to disk. A page on your screen can only ever change the text in the bubble.
- Each screenshot is capped at 1568 px on its long edge. That's as much detail as Claude uses, so it keeps each question light on your plan's allowance.

## Files

- `main.js`: the pet window, tray, shortcut, cursor-following and the ask flow
- `src/claude.js`: the long-running `claude` process, sending screenshots in and streaming answers out
- `src/capture.js`: screenshots of the display you're working on
- `src/prompt.md`: how Hoot answers (short, answer first for quizzes, plain-text maths)
- `src/look.js`: which look frame points at the cursor
- `ui/`: the pet and bubble
- `assets/hoots-spritesheet-v8.webp`: the sprite

## Tests

`npm test` runs against a fake `claude` and covers the stream-json protocol, follow-ups on one process, errors, crashes, New chat and the look directions.

`STUDYPET_SNAPSHOT=/some/dir STUDYPET_ASK="What's on my screen?" npm start` runs the whole flow once and then quits. It saves:
- pictures of the pet and the bubble
- the screenshot Hoot sent
- `answer.json`, which shows the answer, the permission state, the active shortcut, and `auth: "none"` (meaning the subscription was used)

The Hoots sprite comes from OpenAI Codex's built-in pets (copied from the ChatGPT app) and is for personal use only.
