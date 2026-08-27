Add the subagent-approval rule to AGENTS.md (top priority), then report the drift findings for your review before touching them.

**Edit — AGENTS.md**

Insert a new section immediately after the intro paragraph (before `## Project Snapshot`), so it reads as the highest-priority rule in the operational contract:

```markdown
## Agent Conduct

- **Never launch subagents without the user's explicit prior approval** — in every session, for every task. All exploration, search, and implementation work happens directly in the main agent; if delegation seems useful, ask first.
```

Nothing else in the file changes during this step.

**After the edit — reporting only, no further writes**

I will then lay out the AGENTS.md drift found during the audit (the `#playlist-layer` location claim vs. reality, the `/* PLAYLISTS */` CSS marker claim vs. reality, plus any smaller inaccuracies spotted), each with the exact current wording and proposed corrected wording — and leave application of those corrections to your decision.
