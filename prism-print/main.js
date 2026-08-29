const { Plugin } = require("obsidian");

module.exports = class PrismPrintPlugin extends Plugin {
  onload() {
    this.observer = new MutationObserver(() => this.adaptPrintRoots());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    this.adaptPrintRoots();
  }

  onunload() {
    this.observer?.disconnect();
  }

  adaptPrintRoots() {
    for (const root of document.querySelectorAll(".print")) {
      this.adaptPrintRoot(root);
    }
  }

  adaptPrintRoot(root) {
    const dark = document.body.classList.contains("theme-dark");
    root.classList.add("prism-print");
    root.classList.toggle("theme-dark", dark);
    root.classList.toggle("theme-light", !dark);

    for (const name of document.body.classList) {
      if (name.startsWith("pt-")) root.classList.add(name);
    }

    if (root.dataset.prismPrint === "ready") return;
    this.copyTokens(root);
    root.dataset.prismPrint = "ready";
  }

  copyTokens(root) {
    const apply = (source) => {
      const styles = getComputedStyle(source);
      for (let i = 0; i < styles.length; i++) {
        const name = styles[i];
        if (name.startsWith("--")) {
          root.style.setProperty(name, styles.getPropertyValue(name).trim());
        }
      }
    };
    apply(document.documentElement);
    apply(document.body);
  }
};
