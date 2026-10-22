import { defineElement } from "./shared/element.ts";
import { ConfigCardElement } from "./canvas/config-card.ts";
import { ConfigFieldsElement } from "./editor/config-fields.ts";
import {
  DocumentTabsElement,
  SectionNavElement,
} from "./tabs/document-tabs.ts";
import { KeyLibraryElement } from "./keys/key-library.ts";
import { ExportViewElement } from "./export/export-view.ts";
import { ProfileTitleElement } from "./editor/profile-title.ts";
import { WorkPanelElement } from "./panel/work-panel.ts";
import { AppMenuElement } from "./shell/app-menu.ts";
import { StudioAppElement } from "./shell/studio-app.ts";
import { NetworkCanvasElement } from "./canvas/network-canvas.ts";
import { ConfigEditorElement } from "./editor/config-editor.ts";
import { TaskViewElement } from "./panel/task-view.ts";
import "./shared/tooltip.ts";

defineElement("wg-work-panel", WorkPanelElement);
defineElement("wg-profile-title", ProfileTitleElement);
defineElement("wg-document-tabs", DocumentTabsElement);
defineElement("wg-section-nav", SectionNavElement);
defineElement("wg-config-fields", ConfigFieldsElement);
defineElement("wg-config-card", ConfigCardElement);
defineElement("wg-key-library", KeyLibraryElement);
defineElement("wg-export-view", ExportViewElement);
defineElement("wg-app-menu", AppMenuElement);
defineElement("wg-network-canvas", NetworkCanvasElement);
defineElement("wg-config-editor", ConfigEditorElement);
defineElement("wg-task-view", TaskViewElement);
// Register the root last: its template immediately mounts all child elements.
defineElement("wg-studio-app", StudioAppElement);
