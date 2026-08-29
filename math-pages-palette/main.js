const { Plugin, MarkdownView, SuggestModal } = require("obsidian");

const CALLOUTS = [
  { id: "определение", name: "Определение" },
  { id: "теорема", name: "Теорема" },
  { id: "лемма", name: "Лемма" },
  { id: "замечание", name: "Замечание" },
  { id: "пример", name: "Пример" },
  { id: "свойства", name: "Свойства" },
  { id: "соглашение", name: "Соглашение" },
  { id: "доказательство", name: "Доказательство" },
  { id: "следствие", name: "Следствие" },
  { id: "интуиция", name: "Интуиция" },
  { id: "контекст", name: "Контекст" },
  { id: "загадка", name: "Загадка" },
  { id: "билет", name: "Билет" },
];

class PaletteInsertModal extends SuggestModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Блок палитры…");
  }

  getSuggestions(query) {
    const q = query.toLowerCase().trim();
    if (!q) return CALLOUTS;
    return CALLOUTS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }

  renderSuggestion(callout, el) {
    el.createEl("div", { text: callout.name });
    el.createEl("small", { text: `[!${callout.id}]`, cls: "mod-muted" });
  }

  onChooseSuggestion(callout) {
    this.plugin.insertCallout(callout.id);
  }
}

module.exports = class MathPagesPalettePlugin extends Plugin {
  async onload() {
    await this.syncSnippetForCluddle();

    this.addCommand({
      id: "insert-callout",
      name: "Вставить академический блок",
      editorCallback: () => new PaletteInsertModal(this.app, this).open(),
    });
  }

  async syncSnippetForCluddle() {
    try {
      const src = `${this.manifest.dir}/styles.css`;
      const dst = `${this.app.vault.configDir}/snippets/palette-callouts.css`;
      const css = await this.app.vault.adapter.read(src);
      await this.app.vault.adapter.write(dst, css);
    } catch (err) {
      console.error("Math Pages Palette: snippet sync failed", err);
    }
  }

  insertCallout(id) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const editor = view.editor;
    const sel = editor.getSelection();
    const body = sel
      ? sel.split("\n").map((line) => `> ${line}`).join("\n")
      : "> ";
    editor.replaceSelection(`> [!${id}]\n${body}`);
  }
};
