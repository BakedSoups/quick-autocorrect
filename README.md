# Easy Auto Correct

Easy Auto Correct checks the current Obsidian note for spelling and grammar issues using a configurable LanguageTool endpoint.

## Endpoint options

By default, the plugin uses the standard public LanguageTool API:

```text
https://api.languagetool.org/v2/check
```

if you want a more private/offline set up you can change this in **Settings → Easy Auto Correct**:


- **Standard public API**: Uses `https://api.languagetool.org`.
- **Premium API**: Uses `https://api.languagetoolplus.com` with your username and API key.
- **Local server**: Uses `http://localhost:8010`.
- **Custom URL**: Uses any self-hosted LanguageTool-compatible base URL.

When you run the checker, the current note text is sent to the configured endpoint. For the most private setup, run LanguageTool locally or on a server you control and select **Local server** or **Custom URL**.

The plugin does not use Electron spellcheck, cspell, typo-js, nspell, or bundled spellchecker libraries.

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
