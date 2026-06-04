# Better Auto Correct

Better Auto Correct checks the current Obsidian note for spelling and grammar issues using a local LanguageTool server.

## Requirements

Run LanguageTool locally at:

```text
http://localhost:8010/v2/check
```

The plugin does not use Electron spellcheck, cspell, typo-js, nspell, or remote grammar services. When you run the checker, the current note text is sent to your local LanguageTool server on `localhost`.

## Commands

- **Check spelling and grammar**: Checks the current note and opens the first issue.
- **Fix next spelling/grammar issue**: Opens the next known issue, or starts a new check if none are queued.

## Dictionary

Use **Add to Dictionary** in the issue modal to save a word or phrase in plugin data. Future checks ignore LanguageTool matches whose matched text is in that custom dictionary.

## Development

Install dependencies and build with npm:

```bash
npm install
npm run build
```

Release artifacts are `manifest.json`, `main.js`, and `styles.css`.
