import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	requestUrl,
	Setting,
} from "obsidian";

declare const require: ((moduleName: string) => unknown) | undefined;

const LOCAL_LANGUAGE_TOOL_URL = "http://127.0.0.1:8010";
const STANDARD_LANGUAGE_TOOL_URL = "https://api.languagetool.org";
const MAX_REPLACEMENTS = 3;

type NodeRequestFunction = typeof import("node:https").request;

type EndpointMode = "standard" | "local" | "custom";

interface EasyAutoCorrectData {
	customWords: string[];
	endpointMode: EndpointMode;
	serverUrl: string;
	language: string;
}

interface LanguageToolReplacement {
	value: string;
}

interface LanguageToolRule {
	id: string;
	issueType?: string;
	category?: {
		id?: string;
		name?: string;
	};
}

interface LanguageToolMatch {
	message: string;
	offset: number;
	length: number;
	replacements: LanguageToolReplacement[];
	rule: LanguageToolRule;
}

interface LanguageToolResponse {
	matches: LanguageToolMatch[];
}

interface LanguageToolHttpResponse {
	status: number;
	text: string;
	json: unknown;
}

interface Issue {
	match: LanguageToolMatch;
	text: string;
	offset: number;
}

interface SentenceContext {
	before: string;
	match: string;
	after: string;
}

interface TextRange {
	start: number;
	end: number;
}

const DEFAULT_DATA: EasyAutoCorrectData = {
	customWords: [],
	endpointMode: "standard",
	serverUrl: STANDARD_LANGUAGE_TOOL_URL,
	language: "en-US",
};

function getUrlForMode(mode: EndpointMode): string {
	switch (mode) {
		case "local":
			return LOCAL_LANGUAGE_TOOL_URL;
		case "custom":
			return "";
		case "standard":
			return STANDARD_LANGUAGE_TOOL_URL;
	}
}

function normalizeServerUrl(url: string): string {
	return url.trim().replace(/\/v2\/check\/?$/, "").replace(/\/$/, "");
}

class EasyAutoCorrectSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: EasyAutoCorrect) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Checking endpoint").setHeading();
		containerEl.createEl("p", {
			text: "The current note text is sent to the configured checking endpoint when you run a check.",
		});

		let customUrlSetting: Setting;
		new Setting(containerEl)
			.setName("Endpoint")
			.setDesc("Choose where spelling and grammar checks are sent.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({
						standard: "Standard public API",
						local: "Local server",
						custom: "Custom URL",
					})
					.setValue(this.plugin.data.endpointMode)
					.onChange(async (value) => {
						const endpointMode = value as EndpointMode;
						this.plugin.data.endpointMode = endpointMode;
						const serverUrl = getUrlForMode(endpointMode);
						if (serverUrl) {
							this.plugin.data.serverUrl = serverUrl;
						}
						await this.plugin.savePluginData();
					});
			});

		customUrlSetting = new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Use a base URL, without /v2/check.")
			.addText((text) => {
				text
					.setPlaceholder("Server URL")
					.setValue(this.plugin.data.serverUrl)
					.onChange(async (value) => {
						this.plugin.data.serverUrl = normalizeServerUrl(value);
						this.plugin.data.endpointMode = "custom";
						await this.plugin.savePluginData();
					});
			});

		if (this.plugin.data.endpointMode !== "custom") {
			customUrlSetting.descEl.createEl("br");
			customUrlSetting.descEl.createSpan({
				text: `Current: ${this.plugin.data.serverUrl}`,
			});
		}

		new Setting(containerEl)
			.setName("Language")
			.setDesc("Use auto detection or a language code.")
			.addText((text) => {
				text
					.setPlaceholder("Language")
					.setValue(this.plugin.data.language)
					.onChange(async (value) => {
						this.plugin.data.language = value.trim() || "auto";
						await this.plugin.savePluginData();
					});
			});

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Send a short test sentence to the configured endpoint.")
			.addButton((button) => {
				button.setButtonText("Test").onClick(async () => {
					await this.plugin.testLanguageToolConnection();
				});
			});
	}
}

class SpellingGrammarModal extends Modal {
	private contextPreviewEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: EasyAutoCorrect,
		private editor: Editor,
		private issue: Issue,
		private issueIndex: number,
		private issueCount: number,
		private onAdvance: () => void
	) {
		super(app);
	}

	onOpen() {
		this.render();
	}

	private render() {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass("quick-autocorrect-modal");

		titleEl.setText(this.getTitle());

		contentEl.createEl("p", {
			cls: "quick-autocorrect-count",
			text: `Issue ${this.issueIndex + 1} of ${this.issueCount}`,
		});

		contentEl.createEl("h3", {
			cls: "quick-autocorrect-match",
			text: this.issue.text,
		});

		contentEl.createEl("p", {
			cls: "quick-autocorrect-message",
			text: this.issue.match.message,
		});

		this.contextPreviewEl = contentEl.createDiv({
			cls: "quick-autocorrect-context",
		});
		this.renderContextPreview();

		const replacements = this.issue.match.replacements.slice(0, MAX_REPLACEMENTS);
		if (replacements.length > 0) {
			const suggestionContainer = contentEl.createDiv({
				cls: "quick-autocorrect-suggestions",
			});
			for (const replacement of replacements) {
				const button = suggestionContainer.createEl("button", {
					cls: "quick-autocorrect-suggestion",
					text: replacement.value,
				});
				button.addEventListener("mouseenter", () => {
					this.renderContextPreview(replacement.value);
				});
				button.addEventListener("mouseleave", () => {
					this.renderContextPreview();
				});
				button.addEventListener("focus", () => {
					this.renderContextPreview(replacement.value);
				});
				button.addEventListener("blur", () => {
					this.renderContextPreview();
				});
				button.addEventListener("click", () => {
					this.replaceIssue(replacement.value);
					this.close();
					this.onAdvance();
				});
			}
		} else {
			contentEl.createEl("p", {
				cls: "quick-autocorrect-empty",
				text: "No replacement suggestions available.",
			});
		}

		const actionContainer = contentEl.createDiv({
			cls: "quick-autocorrect-actions",
		});

		const addButton = actionContainer.createEl("button", {
			cls: "quick-autocorrect-action",
			text: "Add to dictionary",
		});
		addButton.addEventListener("click", () => {
			void this.plugin.addCustomWord(this.issue.text);
			this.close();
			this.onAdvance();
		});

		const ignoreButton = actionContainer.createEl("button", {
			cls: "quick-autocorrect-action",
			text: "Ignore",
		});
		ignoreButton.addEventListener("click", () => {
			this.close();
			this.onAdvance();
		});

		const nextButton = actionContainer.createEl("button", {
			cls: "quick-autocorrect-action",
			text: "Next",
		});
		nextButton.addEventListener("click", () => {
			this.close();
			this.onAdvance();
		});

		const closeButton = actionContainer.createEl("button", {
			cls: "quick-autocorrect-action",
			text: "Close",
		});
		closeButton.addEventListener("click", () => {
			this.close();
		});
	}

	private renderContextPreview(replacement?: string) {
		if (!this.contextPreviewEl) {
			return;
		}

		const context = this.getSentenceContext(replacement);
		this.contextPreviewEl.empty();

		if (context.before) {
			this.contextPreviewEl.createSpan({ text: context.before });
		}

		this.contextPreviewEl.createSpan({
			cls: replacement
				? "quick-autocorrect-context-replacement"
				: "quick-autocorrect-context-match",
			text: context.match,
		});

		if (context.after) {
			this.contextPreviewEl.createSpan({ text: context.after });
		}
	}

	private getSentenceContext(replacement?: string): SentenceContext {
		const text = this.editor.getValue();
		const matchStart = Math.max(0, Math.min(this.issue.offset, text.length));
		const matchEnd = Math.max(
			matchStart,
			Math.min(matchStart + this.issue.match.length, text.length)
		);
		const sentenceStart = this.findSentenceStart(text, matchStart);
		const sentenceEnd = this.findSentenceEnd(text, matchEnd);

		return {
			before: text.slice(sentenceStart, matchStart),
			match: replacement ?? text.slice(matchStart, matchEnd),
			after: text.slice(matchEnd, sentenceEnd),
		};
	}

	private findSentenceStart(text: string, offset: number): number {
		let index = offset - 1;

		while (index >= 0) {
			const character = text[index];
			if (character === "\n") {
				return this.skipLeadingWhitespace(text, index + 1, offset);
			}
			if (character && /[.!?]/.test(character)) {
				return this.skipLeadingWhitespace(text, index + 1, offset);
			}
			index -= 1;
		}

		return this.skipLeadingWhitespace(text, 0, offset);
	}

	private findSentenceEnd(text: string, offset: number): number {
		let index = offset;

		while (index < text.length) {
			const character = text[index];
			if (character === "\n") {
				return this.trimTrailingWhitespace(text, offset, index);
			}
			if (character && /[.!?]/.test(character)) {
				return this.trimTrailingWhitespace(text, offset, index + 1);
			}
			index += 1;
		}

		return this.trimTrailingWhitespace(text, offset, text.length);
	}

	private skipLeadingWhitespace(text: string, start: number, max: number): number {
		let index = start;
		while (index < max && /\s/.test(text[index] ?? "")) {
			index += 1;
		}
		return index;
	}

	private trimTrailingWhitespace(text: string, min: number, end: number): number {
		let index = end;
		while (index > min && /\s/.test(text[index - 1] ?? "")) {
			index -= 1;
		}
		return index;
	}

	private getTitle(): string {
		return this.plugin.isMisspelling(this.issue.match)
			? "Misspelling found"
			: "Grammar issue found";
	}

	private replaceIssue(replacement: string) {
		const from = this.editor.offsetToPos(this.issue.offset);
		const to = this.editor.offsetToPos(this.issue.offset + this.issue.match.length);

		this.editor.replaceRange(replacement, from, to);
		this.plugin.registerReplacementDelta(
			this.issue.offset,
			replacement.length - this.issue.match.length
		);
	}
}

export default class EasyAutoCorrect extends Plugin {
	data: EasyAutoCorrectData = DEFAULT_DATA;
	private issues: Issue[] = [];
	private currentIssueIndex = 0;
	private activeModal: SpellingGrammarModal | null = null;
	private lastLanguageToolErrorLogKey: string | null = null;

	async onload() {
		await this.loadPluginData();
		this.addSettingTab(new EasyAutoCorrectSettingTab(this.app, this));

		this.addCommand({
			id: "check-spelling-and-grammar",
			name: "Check spelling and grammar",
			callback: async () => {
				const editor = this.getActiveEditor();
				if (!editor) {
					new Notice("Open a note in editing mode first");
					return;
				}

				await this.checkSpellingAndGrammar(editor);
			},
		});

		this.addCommand({
			id: "fix-next-spelling-grammar-issue",
			name: "Fix next spelling/grammar issue",
			callback: async () => {
				const editor = this.getActiveEditor();
				if (!editor) {
					new Notice("Open a note in editing mode first");
					return;
				}

				if (this.issues.length === 0) {
					await this.checkSpellingAndGrammar(editor);
					return;
				}

				this.showCurrentIssue(editor);
			},
		});
	}

	onunload() {
		this.activeModal?.close();
		this.activeModal = null;
	}

	private getActiveEditor(): Editor | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
	}

	async savePluginData() {
		await this.saveData(this.data);
	}

	async testLanguageToolConnection() {
		try {
			const response = await this.requestLanguageTool("This are a test sentence.");
			this.lastLanguageToolErrorLogKey = null;
			new Notice(`LanguageTool connected: ${response.matches.length} issue found`);
		} catch (error) {
			this.reportLanguageToolFailure("LanguageTool connection test failed", error);
		}
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private reportLanguageToolFailure(action: string, error: unknown) {
		const message = this.getLanguageToolFailureMessage(error);
		const logKey = `${action}: ${message}`;

		if (this.lastLanguageToolErrorLogKey !== logKey) {
			console.error(action, error);
			this.lastLanguageToolErrorLogKey = logKey;
		}

		new Notice(`${action}: ${message}`, 12000);
	}

	private getLanguageToolFailureMessage(error: unknown): string {
		const message = this.getErrorMessage(error);
		const checkUrl = this.getCheckUrl();

		if (message.includes("net::ERR_FAILED")) {
			return `Obsidian could not reach ${checkUrl}. Check internet access, VPN/firewall/proxy settings, or use a local/custom LanguageTool server.`;
		}

		if (
			message.includes("ERR_NAME_NOT_RESOLVED") ||
			message.includes("ENOTFOUND") ||
			message.includes("Could not resolve")
		) {
			return `Could not resolve ${this.getCheckHost(checkUrl)}. Check DNS or use a local/custom LanguageTool server.`;
		}

		if (
			message.includes("ERR_CONNECTION_REFUSED") ||
			message.includes("ECONNREFUSED")
		) {
			return `Connection refused by ${checkUrl}. If this is a local server, confirm LanguageTool is running.`;
		}

		if (message.includes("ERR_CERT") || message.includes("certificate")) {
			return `TLS certificate check failed for ${checkUrl}. Check the server certificate or custom URL.`;
		}

		return message;
	}

	private getCheckHost(checkUrl: string): string {
		try {
			return new URL(checkUrl).hostname;
		} catch {
			return checkUrl;
		}
	}

	async addCustomWord(word: string) {
		const normalizedWord = this.normalizeCustomWord(word);

		if (!normalizedWord) {
			return;
		}

		const existingWords = new Set(
			this.data.customWords.map((customWord) =>
				this.normalizeCustomWord(customWord)
			)
		);

		if (!existingWords.has(normalizedWord)) {
			this.data.customWords.push(word.trim());
			await this.saveData(this.data);
			new Notice(`Added "${word}" to dictionary`);
		}
	}

	isMisspelling(match: LanguageToolMatch): boolean {
		return (
			match.rule.issueType === "misspelling" ||
			match.rule.category?.id === "TYPOS"
		);
	}

	registerReplacementDelta(issueOffset: number, delta: number) {
		if (delta === 0) {
			return;
		}

		for (const issue of this.issues) {
			if (issue.offset > issueOffset) {
				issue.offset += delta;
			}
		}
	}

	private async loadPluginData() {
		const loadedData = (await this.loadData()) as Partial<EasyAutoCorrectData> | null;
		const endpointMode = this.normalizeEndpointMode(loadedData?.endpointMode);
		const defaultServerUrl = getUrlForMode(endpointMode) || DEFAULT_DATA.serverUrl;

		this.data = {
			...DEFAULT_DATA,
			...loadedData,
			endpointMode,
			serverUrl: normalizeServerUrl(
				endpointMode === "custom"
					? loadedData?.serverUrl || defaultServerUrl
					: defaultServerUrl
			),
			language: loadedData?.language?.trim() || DEFAULT_DATA.language,
			customWords: Array.isArray(loadedData?.customWords)
				? loadedData.customWords
				: [],
		};
	}

	private async checkSpellingAndGrammar(editor: Editor) {
		const text = editor.getValue();

		if (!text.trim()) {
			new Notice("Nothing to check");
			return;
		}

		new Notice("Checking spelling and grammar...");

		try {
			const response = await this.requestLanguageTool(text);
			this.lastLanguageToolErrorLogKey = null;
			this.issues = this.buildIssues(text, response.matches);
			this.currentIssueIndex = 0;

			if (this.issues.length === 0) {
				new Notice("No spelling or grammar issues found");
				return;
			}

			this.showCurrentIssue(editor);
		} catch (error) {
			this.reportLanguageToolFailure("LanguageTool check failed", error);
		}
	}

	private async requestLanguageTool(text: string): Promise<LanguageToolResponse> {
		const body = new URLSearchParams();
		body.set("text", text);
		body.set("language", this.data.language || "auto");
		if (this.data.language === "auto") {
			body.set("preferredVariants", "en-US");
		}

		const checkUrl = this.getCheckUrl();
		const bodyText = body.toString();

		let response: LanguageToolHttpResponse;
		try {
			response = await requestUrl({
				url: checkUrl,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				body: bodyText,
				throw: false,
			});
		} catch (error) {
			if (this.shouldRetryWithNodeRequest(error)) {
				response = await this.requestLanguageToolWithNode(checkUrl, bodyText);
			} else {
				throw new Error(`Could not reach ${checkUrl}: ${this.getErrorMessage(error)}`);
			}
		}

		return this.parseLanguageToolResponse(checkUrl, response);
	}

	private shouldRetryWithNodeRequest(error: unknown): boolean {
		return this.getErrorMessage(error).includes("net::ERR_FAILED");
	}

	private async requestLanguageToolWithNode(
		checkUrl: string,
		bodyText: string
	): Promise<LanguageToolHttpResponse> {
		const request = this.getNodeRequest(checkUrl);

		if (!request) {
			throw new Error(
				`Could not reach ${checkUrl}: Obsidian requestUrl failed and Node HTTP is unavailable`
			);
		}

		return new Promise((resolve, reject) => {
			const url = new URL(checkUrl);
			const bodyLength = new TextEncoder().encode(bodyText).byteLength;
			const req = request(
				url,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						"Content-Length": String(bodyLength),
						"User-Agent": "Obsidian Easy AutoCorrect",
					},
					timeout: 30000,
				},
				(res) => {
					const chunks: string[] = [];
					res.setEncoding("utf8");
					res.on("data", (chunk: string) => chunks.push(chunk));
					res.on("end", () => {
						const text = chunks.join("");
						let json: unknown;
						try {
							json = JSON.parse(text);
						} catch {
							json = null;
						}

						resolve({
							status: res.statusCode ?? 0,
							text,
							json,
						});
					});
				}
			);

			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy(new Error(`Timed out reaching ${checkUrl}`));
			});
			req.write(bodyText);
			req.end();
		});
	}

	private getNodeRequest(checkUrl: string): NodeRequestFunction | null {
		if (typeof require !== "function") {
			return null;
		}

		const protocol = new URL(checkUrl).protocol;
		const moduleName = protocol === "http:" ? "node:http" : "node:https";
		const module = require(moduleName) as { request?: NodeRequestFunction };

		return module.request ?? null;
	}

	private parseLanguageToolResponse(
		checkUrl: string,
		response: LanguageToolHttpResponse
	): LanguageToolResponse {
		if (response.status < 200 || response.status >= 300) {
			console.error("LanguageTool response body", response.text);
			throw new Error("LanguageTool returned " + response.status);
		}

		if (!this.isLanguageToolResponse(response.json)) {
			console.error("LanguageTool response body", response.text);
			throw new Error(`LanguageTool returned an invalid response from ${checkUrl}`);
		}

		return response.json;
	}

	private isLanguageToolResponse(json: unknown): json is LanguageToolResponse {
		return (
			typeof json === "object" &&
			json !== null &&
			Array.isArray((json as Partial<LanguageToolResponse>).matches)
		);
	}

	private getCheckUrl(): string {
		return `${normalizeServerUrl(this.data.serverUrl)}/v2/check`;
	}

	private buildIssues(text: string, matches: LanguageToolMatch[]): Issue[] {
		const customWords = new Set(
			this.data.customWords.map((word) => this.normalizeCustomWord(word))
		);
		const ignoredRanges = this.getLatexRanges(text);

		return matches
			.map((match) => ({
				match,
				text: text.slice(match.offset, match.offset + match.length),
				offset: match.offset,
			}))
			.filter((issue) => {
				const normalizedText = this.normalizeCustomWord(issue.text);
				return (
					normalizedText &&
					!customWords.has(normalizedText) &&
					!this.isRangeIgnored(
						issue.offset,
						issue.offset + issue.match.length,
						ignoredRanges
					)
				);
			});
	}

	private getLatexRanges(text: string): TextRange[] {
		const ranges: TextRange[] = [];
		let index = 0;

		while (index < text.length) {
			const delimiter = this.getLatexOpeningDelimiter(text, index);
			if (!delimiter) {
				index += 1;
				continue;
			}

			const closingIndex = this.findLatexClosingDelimiter(
				text,
				index + delimiter.open.length,
				delimiter.close
			);
			if (closingIndex === -1) {
				index += delimiter.open.length;
				continue;
			}

			const end = closingIndex + delimiter.close.length;
			ranges.push({ start: index, end });
			index = end;
		}

		return ranges;
	}

	private getLatexOpeningDelimiter(
		text: string,
		index: number
	): { open: string; close: string } | null {
		if (this.isEscaped(text, index)) {
			return null;
		}

		if (text.startsWith("$$", index)) {
			return { open: "$$", close: "$$" };
		}

		if (text.startsWith("\\[", index)) {
			return { open: "\\[", close: "\\]" };
		}

		if (text.startsWith("\\(", index)) {
			return { open: "\\(", close: "\\)" };
		}

		if (text[index] === "$" && !this.isDollarDelimiterInvalid(text, index)) {
			return { open: "$", close: "$" };
		}

		return null;
	}

	private findLatexClosingDelimiter(
		text: string,
		start: number,
		delimiter: string
	): number {
		let index = start;

		while (index < text.length) {
			if (
				text.startsWith(delimiter, index) &&
				!this.isEscaped(text, index) &&
				!(
					delimiter === "$" &&
					this.isDollarDelimiterInvalid(text, index)
				)
			) {
				return index;
			}

			index += 1;
		}

		return -1;
	}

	private isDollarDelimiterInvalid(text: string, index: number): boolean {
		const previous = text[index - 1] ?? "";
		const next = text[index + 1] ?? "";

		return (
			next === "$" ||
			/\s/.test(next) ||
			/\d/.test(next) ||
			(Boolean(previous) && /\d/.test(previous))
		);
	}

	private isEscaped(text: string, index: number): boolean {
		let slashCount = 0;
		let cursor = index - 1;

		while (cursor >= 0 && text[cursor] === "\\") {
			slashCount += 1;
			cursor -= 1;
		}

		return slashCount % 2 === 1;
	}

	private isRangeIgnored(start: number, end: number, ranges: TextRange[]): boolean {
		return ranges.some((range) => start < range.end && end > range.start);
	}

	private showCurrentIssue(editor: Editor) {
		if (this.currentIssueIndex >= this.issues.length) {
			new Notice("Finished checking spelling and grammar");
			this.resetSession();
			return;
		}

		const issue = this.issues[this.currentIssueIndex];
		if (!issue) {
			new Notice("Finished checking spelling and grammar");
			this.resetSession();
			return;
		}

		this.revealIssueInEditor(editor, issue);
		this.activeModal?.close();
		this.activeModal = new SpellingGrammarModal(
			this.app,
			this,
			editor,
			issue,
			this.currentIssueIndex,
			this.issues.length,
			() => {
				this.currentIssueIndex += 1;
				this.showCurrentIssue(editor);
			}
		);
		this.activeModal.open();
	}

	private revealIssueInEditor(editor: Editor, issue: Issue) {
		const textLength = editor.getValue().length;
		const fromOffset = Math.max(0, Math.min(issue.offset, textLength));
		const toOffset = Math.max(
			fromOffset,
			Math.min(issue.offset + issue.match.length, textLength)
		);
		const from = editor.offsetToPos(fromOffset);
		const to = editor.offsetToPos(toOffset);

		editor.scrollIntoView({ from, to }, true);
		editor.setSelection(from, to);
	}

	private resetSession() {
		this.issues = [];
		this.currentIssueIndex = 0;
		this.activeModal = null;
	}

	private normalizeCustomWord(word: string): string {
		return word.trim().toLowerCase();
	}

	private normalizeEndpointMode(mode: string | undefined): EndpointMode {
		if (
			mode === "standard" ||
			mode === "local" ||
			mode === "custom"
		) {
			return mode;
		}

		return DEFAULT_DATA.endpointMode;
	}
}
