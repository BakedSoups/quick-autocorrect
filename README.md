# Easy Auto Correct
Usually in Obsidian, correcting misspellings means hovering over each typo, opening the suggestion menu, and fixing words one at a time. I liked the Google Docs tool that scans the whole document and shows suggestions in one place letting me click away at the corrections, so I made a custom plugin to port that tool over to obsidian! 

<img width="800" height="450" alt="before" src="https://github.com/user-attachments/assets/51352690-e392-49f5-bc59-07b56c6e264c" />
<img width="800" height="450" alt="after" src="https://github.com/user-attachments/assets/672febcc-a617-4014-b14d-8681e859cafd" />


Easy Auto Correct reviews spelling and grammar issues in the current note from a Google Docs-style suggestion menu.

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

## Privacy

Easy Auto Correct sends the current note text to the endpoint selected in settings only when you run a check. The default endpoint is the standard public LanguageTool API. To avoid sending note text to a public service, run a local or self-hosted LanguageTool server and select **Local server** or **Custom URL**.

The plugin does not collect analytics, store telemetry, or send vault data in the background.

## Local server with Docker

If you want to keep spellchecking local and private instead of using the public API, run LanguageTool as a separate local Docker container:

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

## Release

For an Obsidian community plugin release:

1. Run `npm run build`.
2. Confirm `manifest.json` and `versions.json` use the same plugin version.
3. Create a GitHub release whose tag exactly matches `manifest.json` `version`, for example `1.0.0`.
4. Attach `manifest.json`, `main.js`, and `styles.css` as individual release assets.

Do not attach or commit `data.json`, `node_modules`, or other local runtime files.
