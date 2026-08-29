const { Plugin, MarkdownView, Modal } = require("obsidian");

const CALLOUTS = [
  { id: "определение", name: "Определение", hint: "Точное понятие" },
  { id: "теорема", name: "Теорема", hint: "Основное утверждение" },
  { id: "лемма", name: "Лемма", hint: "Вспомогательный результат" },
  { id: "замечание", name: "Замечание", hint: "Важное уточнение" },
  { id: "пример", name: "Пример", hint: "Разбор применения" },
  { id: "свойства", name: "Свойства", hint: "Набор свойств" },
  { id: "соглашение", name: "Соглашение", hint: "Обозначения и правила" },
  { id: "доказательство", name: "Доказательство", hint: "Обоснование результата" },
  { id: "следствие", name: "Следствие", hint: "Вывод из утверждения" },
  { id: "интуиция", name: "Интуиция", hint: "Идея и понимание" },
  { id: "контекст", name: "Контекст", hint: "Связи и предпосылки" },
  { id: "загадка", name: "Загадка", hint: "Вопрос для размышления" },
  { id: "билет", name: "Билет", hint: "Экзаменационная тема" },
];

class PaletteInsertModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.target = plugin.captureEditorTarget();
    this.filtered = CALLOUTS;
    this.activeIndex = 0;
  }

  onOpen() {
    this.modalEl.addClass("mpp-picker-modal");
    this.contentEl.empty();

    const heading = this.contentEl.createDiv({ cls: "mpp-picker__heading" });
    heading.createDiv({ cls: "mpp-picker__title", text: "Академический блок" });
    heading.createDiv({
      cls: "mpp-picker__subtitle",
      text: "Выберите структуру для текущего фрагмента",
    });

    this.searchInput = this.contentEl.createEl("input", {
      cls: "mpp-picker__search",
      attr: {
        type: "search",
        placeholder: "Найти блок…",
        "aria-label": "Поиск академического блока",
      },
    });
    this.grid = this.contentEl.createDiv({
      cls: "mpp-picker__grid",
      attr: { role: "listbox" },
    });

    this.searchInput.addEventListener("input", () => this.applyFilter());
    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") this.moveActive(1, event);
      if (event.key === "ArrowLeft") this.moveActive(-1, event);
      if (event.key === "ArrowDown") this.moveActive(2, event);
      if (event.key === "ArrowUp") this.moveActive(-2, event);
      if (event.key === "Enter") {
        event.preventDefault();
        this.chooseActive();
      }
    });

    this.renderCards();
    requestAnimationFrame(() => this.searchInput.focus());
  }

  onClose() {
    this.contentEl.empty();
  }

  applyFilter() {
    const query = this.searchInput.value.toLocaleLowerCase("ru-RU").trim();
    this.filtered = query
      ? CALLOUTS.filter((callout) =>
          `${callout.name} ${callout.id} ${callout.hint}`
            .toLocaleLowerCase("ru-RU")
            .includes(query)
        )
      : CALLOUTS;
    this.activeIndex = 0;
    this.renderCards();
  }

  renderCards() {
    this.grid.empty();

    if (!this.filtered.length) {
      this.grid.createDiv({
        cls: "mpp-picker__empty",
        text: "Подходящих блоков нет",
      });
      return;
    }

    this.filtered.forEach((callout, index) => {
      const card = this.grid.createEl("button", {
        cls: "mpp-picker__card callout",
        attr: {
          type: "button",
          "data-callout": callout.id,
          role: "option",
          "aria-selected": String(index === this.activeIndex),
        },
      });
      card.toggleClass("is-active", index === this.activeIndex);

      const title = card.createDiv({ cls: "callout-title" });
      title.createDiv({ cls: "callout-icon" });
      title.createDiv({ cls: "callout-title-inner", text: callout.name });
      card.createDiv({ cls: "mpp-picker__hint", text: callout.hint });

      card.addEventListener("mouseenter", () => {
        this.activeIndex = index;
        this.syncActiveCard();
      });
      card.addEventListener("click", () => this.choose(callout));
    });
  }

  moveActive(delta, event) {
    if (!this.filtered.length) return;
    event.preventDefault();
    this.activeIndex =
      (this.activeIndex + delta + this.filtered.length) % this.filtered.length;
    this.syncActiveCard();
  }

  syncActiveCard() {
    const cards = Array.from(this.grid.querySelectorAll(".mpp-picker__card"));
    cards.forEach((card, index) => {
      const active = index === this.activeIndex;
      card.toggleClass("is-active", active);
      card.setAttribute("aria-selected", String(active));
    });
    cards[this.activeIndex]?.scrollIntoView({ block: "nearest" });
  }

  chooseActive() {
    const callout = this.filtered[this.activeIndex];
    if (callout) this.choose(callout);
  }

  choose(callout) {
    this.close();
    this.plugin.insertCallout(callout.id, this.target);
  }
}

module.exports = class MathPagesPalettePlugin extends Plugin {
  async onload() {
    await this.connectToCluddle();

    this.addCommand({
      id: "insert-callout",
      name: "Вставить академический блок",
      editorCallback: () => new PaletteInsertModal(this.app, this).open(),
    });
  }

  async connectToCluddle() {
    const cluddle =
      this.app.plugins?.getPlugin?.("cluddle-callouts") ||
      this.app.plugins?.plugins?.["cluddle-callouts"];
    const registry = cluddle?.registry;
    if (!registry?.parseCalloutBlocks || !registry?.refresh) return;

    const sourceId = this.manifest.id;
    const injectCallouts = async () => {
      const css = await this.app.vault.adapter.read(
        `${this.manifest.dir}/styles.css`
      );
      const customCallouts = registry.customCallouts.filter(
        (callout) => callout.snippetId !== sourceId
      );
      const aliasToPrimary = new Map(registry.aliasToPrimary);
      const seen = new Set(customCallouts.map((callout) => callout.id));

      for (const block of registry.parseCalloutBlocks(css, sourceId)) {
        const primaryId = block.ids[0];
        if (!primaryId || seen.has(primaryId)) continue;

        for (const alias of block.ids) {
          aliasToPrimary.set(alias, primaryId);
        }
        seen.add(primaryId);
        customCallouts.push({
          id: primaryId,
          aliases: block.ids.slice(1),
          concept: block.concept || primaryId,
          icon: block.icon,
          groups: block.groups || [],
          snippetId: sourceId,
        });
      }

      registry.customCallouts = customCallouts;
      registry.aliasToPrimary = aliasToPrimary;
    };

    let refreshTimer = 0;
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(async () => {
          await registry.refresh();
          await injectCallouts();
        }, 80);
      })
    );
    this.register(() => {
      window.clearTimeout(refreshTimer);
    });
    await injectCallouts();
  }

  captureEditorTarget() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    const editor = view.editor;
    return {
      editor,
      from: editor.getCursor("from"),
      to: editor.getCursor("to"),
      selection: editor.getSelection(),
    };
  }

  insertCallout(id, target = this.captureEditorTarget()) {
    if (!target) return;
    const { editor, from, to, selection } = target;
    const body = selection
      ? selection.split("\n").map((line) => `> ${line}`).join("\n")
      : "> ";
    const markdown = `> [!${id}]\n${body}`;
    editor.replaceRange(markdown, from, to);

    const lines = markdown.split("\n");
    editor.setCursor({
      line: from.line + lines.length - 1,
      ch: lines.length === 1 ? from.ch + lines[0].length : lines.at(-1).length,
    });
    editor.focus();
  }
};
