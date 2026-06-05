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

const LOCAL_LANGUAGE_TOOL_URL = "http://127.0.0.1:8010";
const STANDARD_LANGUAGE_TOOL_URL = "https://api.languagetool.org";
const MAX_REPLACEMENTS = 3;

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

interface Issue {
	match: LanguageToolMatch;
	text: string;
	offset: number;
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
		contentEl.addClass("easy-auto-correct-modal");

		titleEl.setText(this.getTitle());

		contentEl.createEl("p", {
			cls: "easy-auto-correct-count",
			text: `Issue ${this.issueIndex + 1} of ${this.issueCount}`,
		});

		contentEl.createEl("h3", {
			cls: "easy-auto-correct-match",
			text: this.issue.text,
		});

		contentEl.createEl("p", {
			cls: "easy-auto-correct-message",
			text: this.issue.match.message,
		});

		const replacements = this.issue.match.replacements.slice(0, MAX_REPLACEMENTS);
		if (replacements.length > 0) {
			const suggestionContainer = contentEl.createDiv({
				cls: "easy-auto-correct-suggestions",
			});
			for (const replacement of replacements) {
				const button = suggestionContainer.createEl("button", {
					cls: "easy-auto-correct-suggestion",
					text: replacement.value,
				});
				button.addEventListener("click", () => {
					this.replaceIssue(replacement.value);
					this.close();
					this.onAdvance();
				});
			}
		} else {
			contentEl.createEl("p", {
				cls: "easy-auto-correct-empty",
				text: "No replacement suggestions available.",
			});
		}

		const actionContainer = contentEl.createDiv({
			cls: "easy-auto-correct-actions",
		});

		const addButton = actionContainer.createEl("button", {
			cls: "easy-auto-correct-action",
			text: "Add to dictionary",
		});
		addButton.addEventListener("click", () => {
			void this.plugin.addCustomWord(this.issue.text);
			this.close();
			this.onAdvance();
		});

		const ignoreButton = actionContainer.createEl("button", {
			cls: "easy-auto-correct-action",
			text: "Ignore",
		});
		ignoreButton.addEventListener("click", () => {
			this.close();
			this.onAdvance();
		});

		const nextButton = actionContainer.createEl("button", {
			cls: "easy-auto-correct-action",
			text: "Next",
		});
		nextButton.addEventListener("click", () => {
			this.close();
			this.onAdvance();
		});

		const closeButton = actionContainer.createEl("button", {
			cls: "easy-auto-correct-action",
			text: "Close",
		});
		closeButton.addEventListener("click", () => {
			this.close();
		});
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
			new Notice(`LanguageTool connected: ${response.matches.length} issue found`);
		} catch (error) {
			console.error("LanguageTool connection test failed", error);
			new Notice(`Server connection failed: ${this.getErrorMessage(error)}`);
		}
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
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
			this.issues = this.buildIssues(text, response.matches);
			this.currentIssueIndex = 0;

			if (this.issues.length === 0) {
				new Notice("No spelling or grammar issues found");
				return;
			}

			this.showCurrentIssue(editor);
		} catch (error) {
			console.error("LanguageTool check failed", error);
			new Notice(`Server connection failed: ${this.getErrorMessage(error)}`);
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

		let response;
		try {
			response = await requestUrl({
				url: checkUrl,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				body: bodyText,
				throw: false,
			});
		} catch (error) {
			throw new Error(`Could not reach ${checkUrl}: ${this.getErrorMessage(error)}`);
		}

		if (response.status < 200 || response.status >= 300) {
			console.error("LanguageTool response body", response.text);
			throw new Error("LanguageTool returned " + response.status);
		}

		return response.json as LanguageToolResponse;
	}

	private getCheckUrl(): string {
		return `${normalizeServerUrl(this.data.serverUrl)}/v2/check`;
	}

	private buildIssues(text: string, matches: LanguageToolMatch[]): Issue[] {
		const customWords = new Set(
			this.data.customWords.map((word) => this.normalizeCustomWord(word))
		);

		return matches
			.map((match) => ({
				match,
				text: text.slice(match.offset, match.offset + match.length),
				offset: match.offset,
			}))
			.filter((issue) => {
				const normalizedText = this.normalizeCustomWord(issue.text);
				return normalizedText && !customWords.has(normalizedText);
			});
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
