---
title: "The CLI for developers and agents"
description: "A CLI for developers and agents"
url: "https://cli.sentry.dev/_preview/pr-1167/"
---

# The CLI for developers and agents

<InstallSelector options={[
  { label: "curl", command: "curl https://cli.sentry.dev/install -fsS | bash" },
  { label: "brew", command: "brew install getsentry/tools/sentry" },
  { label: "npx", command: "npx sentry@latest" },
  { label: "npm", command: "npm install -g sentry" },
  { label: "pnpm", command: "pnpm add -g sentry" },
  { label: "bun", command: "bun add -g sentry" }
]} />
[Or read the documentation.](https://cli.sentry.dev/_preview/pr-1167/getting-started.md)

<Terminal background="custom" />

{/* ============================================
    Features Section - Horizontal Rows with Terminals
    ============================================ */}

<section class="feature-section">
  <div class="feature-section-inner">
    <div class="feature-text">
      <h3>It Knows Your Project</h3>
      <p>No config files. No flags. The CLI reads your <code>.env</code>, detects your project from the codebase, and just works. Monorepos, multiple orgs, complex setups — all handled automatically.</p>
      <p>Stop memorizing project slugs and DSNs. Start typing commands that make sense.</p>
    </div>
    <FeatureVisual image={sectionBg1}>
      <FeatureTerminal title="Terminal">
        <div class="line"><span class="prompt">$</span> <span class="command">sentry issue list</span></div>
        <div class="line dimmed">Detected project: my-app (from .env)</div>
        <div class="spacer"></div>
        <pre class="table-box"><span class="border">╭─────────┬────────────┬──────────────────────────────────────────┬───────╮</span>
<span class="border">│</span> <span class="header-text">LEVEL</span>   <span class="border">│</span> <span class="header-text">SHORT ID</span>   <span class="border">│</span> <span class="header-text">TITLE</span>                                    <span class="border">│</span> <span class="header-text">COUNT</span> <span class="border">│</span>
<span class="border">├─────────┼────────────┼──────────────────────────────────────────┼───────┤</span>
<span class="border">│</span> <span class="red-text">ERROR</span>   <span class="border">│</span> MYAPP-WQ   <span class="border">│</span> <span class="dimmed">TypeError: Cannot read property 'map'...</span> <span class="border">│</span>   142 <span class="border">│</span>
<span class="border">│</span> <span class="yellow-text">WARN</span>    <span class="border">│</span> MYAPP-X3   <span class="border">│</span> <span class="dimmed">Failed to fetch user data from API</span>       <span class="border">│</span>    89 <span class="border">│</span>
<span class="border">│</span> <span class="red-text">ERROR</span>   <span class="border">│</span> MYAPP-R7   <span class="border">│</span> <span class="dimmed">Connection timeout after 30s</span>             <span class="border">│</span>    34 <span class="border">│</span>
<span class="border">╰─────────┴────────────┴──────────────────────────────────────────┴───────╯</span></pre>
      </FeatureTerminal>
    </FeatureVisual>
  </div>
</section>

<section class="feature-section">
  
      <h3>Ask Seer Why</h3>
      Get AI-powered root cause analysis right in your terminal. Seer analyzes stack traces, related events, and your codebase to explain exactly what went wrong and why.
      Then run `sentry issue plan` to get a step-by-step fix you can apply immediately.
    
    <FeatureVisual image={sectionBg2}>
      <FeatureTerminal title="Terminal">
        $ sentry issue explain WQ
        Analyzing MYAPP-WQ...
        
        Root Cause: The user object is undefined when
        accessed before the auth check completes in useEffect.
        
        Affected: src/hooks/useUser.ts:42
        Run `sentry issue plan` for a fix.</div>
      </FeatureTerminal>
    </FeatureVisual>
  </div>
</section>

<section class="feature-section">
  <div class="feature-section-inner">
    <div class="feature-text">
      <h3>Works With Everything</h3>
      <p>Structured JSON output for scripts and pipelines. Open issues directly in your browser. Pipe to <code>jq</code>, <code>fzf</code>, or your favorite tools.</p>
      <p>Built for humans and AI agents alike — every command is predictable, composable, and automation-ready.</p>
    </div>
    <FeatureVisual image={sectionBg3}>
      <FeatureTerminal title="Terminal">
        <div class="line"><span class="prompt">$</span> <span class="command">sentry org list --json | jq '.[0]'</span></div>
        <div class="spacer"></div>
        <div class="line">{"{"}</div>
        <div class="line">  <span class="highlight">"slug"</span>: "my-org",</div>
        <div class="line">  <span class="highlight">"name"</span>: "My Organization",</div>
        <div class="line">  <span class="highlight">"projects"</span>: 12,</div>
        <div class="line">  <span class="highlight">"members"</span>: 8</div>
        <div class="line">{"}"}</div>
      </FeatureTerminal>
    </FeatureVisual>
  </div>
</section>

## Pages in this section

- [Installation](https://cli.sentry.dev/_preview/pr-1167/getting-started.md)
- [Self-Hosted](https://cli.sentry.dev/_preview/pr-1167/self-hosted.md)
- [Configuration](https://cli.sentry.dev/_preview/pr-1167/configuration.md)
- [Library Usage](https://cli.sentry.dev/_preview/pr-1167/library-usage.md)
- [Agentic Usage](https://cli.sentry.dev/_preview/pr-1167/agentic-usage.md)
- [Contributing](https://cli.sentry.dev/_preview/pr-1167/contributing.md)
- [Agent Guidance](https://cli.sentry.dev/_preview/pr-1167/agent-guidance.md)
- [Commands](https://cli.sentry.dev/_preview/pr-1167/commands.md)
- [Exit Codes](https://cli.sentry.dev/_preview/pr-1167/exit-codes.md)
- [Features](https://cli.sentry.dev/_preview/pr-1167/features.md)
