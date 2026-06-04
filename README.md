# Easy Auto Correct

Easy Auto Correct checks the current Obsidian note for spelling and grammar issues using a configurable LanguageTool endpoint.

## Endpoint options

By default, the plugin uses the standard public LanguageTool API:

```text
https://api.languagetool.org/v2/check
```

You can change the endpoint in **Settings → Easy Auto Correct**:

- **Standard public API**: Uses `https://api.languagetool.org`.
- **Premium API**: Uses `https://api.languagetoolplus.com` with your username and API key.
- **Local server**: Uses `http://localhost:8010`.
- **Custom URL**: Uses any LanguageTool-compatible base URL.

When you run the checker, the current note text is sent to the configured endpoint. This plugin does not install, bundle, or manage a LanguageTool server.

The plugin does not use Electron spellcheck, cspell, typo-js, nspell, or bundled spellchecker libraries.

## Local server with Docker

if you want to make all your spellchecking offline/private without the public API, run LanguageTool as a separate local Docker container:

```bash
docker run --rm -p 8010:8010 silviof/docker-languagetool
```

Then open **Settings → Easy Auto Correct** and select:

```text
Endpoint: Local server
Server URL: http://localhost:8010
```

The plugin sends requests to `http://localhost:8010/v2/check`. The Docker container is not part of this repository or the Obsidian plugin release.

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
