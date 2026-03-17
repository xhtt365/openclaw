// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/components/dashboard-header.ts，用于二开定制

import { LitElement, html } from "lit";
import { titleForTab, type Tab } from "../navigation.ts";

export class DashboardHeader extends LitElement {
  static properties = {
    tab: { type: String },
  };

  declare tab: Tab;

  override createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.tab = "chat";
  }

  override render() {
    const label = titleForTab(this.tab);

    return html`
      <div class="dashboard-header">
        <div class="dashboard-header__breadcrumb">
          <span
            class="dashboard-header__breadcrumb-link"
            @click=${() => this.dispatchEvent(new CustomEvent("navigate", { detail: "overview", bubbles: true, composed: true }))}
          >
            OpenClaw
          </span>
          <span class="dashboard-header__breadcrumb-sep">›</span>
          <span class="dashboard-header__breadcrumb-current">${label}</span>
        </div>
        <div class="dashboard-header__actions">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("dashboard-header")) {
  customElements.define("dashboard-header", DashboardHeader);
}
