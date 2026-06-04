import { App, Editor, MarkdownView, Modal, Notice, Plugin } from "obsidian";

const LANGUAGE_TOOL_ENDPOINT = "http://localhost:8010/v2/check";
const MAX_REPLACEMENTS = 3;

interface BetterAutoCorrectData {
	customWords: string[];
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

const DEFAULT_DATA: BetterAutoCorrectData = {
	customWords: [],
};

class SpellingGrammarModal extends Modal {
	constructor(
		app: App,
		private plugin: BetterAutoCorrect,
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

		titleEl.setText(this.getTitle());

		contentEl.createEl("p", {
			text: `Issue ${this.issueIndex + 1} of ${this.issueCount}`,
		});

		contentEl.createEl("h3", {
			text: this.issue.text,
		});

		contentEl.createEl("p", {
			text: this.issue.match.message,
		});

		const replacements = this.issue.match.replacements.slice(0, MAX_REPLACEMENTS);
		if (replacements.length > 0) {
			const suggestionContainer = contentEl.createDiv();
			for (const replacement of replacements) {
				const button = suggestionContainer.createEl("button", {
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
				text: "No replacement suggestions available.",
			});
		}

		const actionContainer = contentEl.createDiv();

		const addButton = actionContainer.createEl("button", {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text: "Add to Dictionary",
		});
		addButton.addEventListener("click", () => {
			void this.plugin.addCustomWord(this.issue.text);
			this.close();
			this.onAdvance();
		});

		const ignoreButton = actionContainer.createEl("button", {
			text: "Ignore",
		});
		ignoreButton.addEventListener("click", () => {
			this.close();
			this.onAdvance();
		});

		const nextButton = actionContainer.createEl("button", {
			text: "Next",
		});
		nextButton.addEventListener("click", () => {
			this.close();
			this.onAdvance();
		});

		const closeButton = actionContainer.createEl("button", {
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

export default class BetterAutoCorrect extends Plugin {
	private data: BetterAutoCorrectData = DEFAULT_DATA;
	private issues: Issue[] = [];
	private currentIssueIndex = 0;
	private activeModal: SpellingGrammarModal | null = null;

	async onload() {
		await this.loadPluginData();

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
		const loadedData = (await this.loadData()) as Partial<BetterAutoCorrectData> | null;

		this.data = {
			...DEFAULT_DATA,
			...loadedData,
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("Could not reach LanguageTool at localhost:8010");
		}
	}

	private async requestLanguageTool(text: string): Promise<LanguageToolResponse> {
		const body = new URLSearchParams();
		body.set("text", text);
		body.set("language", "auto");
		body.set("preferredVariants", "en-US");

		// eslint-disable-next-line no-restricted-globals
		const response = await fetch(LANGUAGE_TOOL_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});

		if (!response.ok) {
			throw new Error(`LanguageTool returned ${response.status}`);
		}

		return (await response.json()) as LanguageToolResponse;
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
}
