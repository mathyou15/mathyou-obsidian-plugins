const { Plugin } = require("obsidian");

module.exports = class PrismPrintPlugin extends Plugin {
  onload() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(".print")) this.adaptPrintRoot(node);
        }
      }
    });
    this.observer.observe(document.body, {
      childList: true,
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
    if (root.dataset.prismPrint === "ready") return;
    root.dataset.prismPrint = "ready";

    const dark = document.body.classList.contains("theme-dark");
    root.classList.add("prism-print");
    root.classList.toggle("theme-dark", dark);
    root.classList.toggle("theme-light", !dark);

    for (const name of document.body.classList) {
      if (name.startsWith("pt-")) root.classList.add(name);
    }

    this.copyTokens(root);
  }

  copyTokens(root) {
    const styles = getComputedStyle(document.body);
    for (let i = 0; i < styles.length; i++) {
      const name = styles[i];
      if (name.startsWith("--")) {
        root.style.setProperty(name, styles.getPropertyValue(name).trim());
      }
    }
  }
};
