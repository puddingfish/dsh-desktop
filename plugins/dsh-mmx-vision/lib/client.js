/**
 * DSH mmx 图像理解插件（browser 半边）。
 * - send-hook：带图片的发送改写为 mmx-vision 引用（上传到宿主附件路由）；
 * - preview：会话里的 `![图片](/mmx-vision/raw/…)` 引用原地升级为缩略图（点击看大图）；
 * - 设置卡片：注册在 web-ui 插件配置页（mmxPath / 默认指令 / 超时 / 预览开关）。
 * 移植自 @linxin666/dsh-tool-describe-image（Apache-2.0）。
 * @module dsh-mmx-vision/client
 */

window.__ModuleLoader__.load({
	id: "dsh-mmx-vision",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		const h = react.createElement;
		const useState = react.useState;
		//#region css
		const previewCss = ".mVp9_preview{margin:4px 0;display:block}.mVp9_thumbButton{cursor:zoom-in;background:0 0;border:0;margin:0;padding:0;display:block}.mVp9_thumbButton:focus-visible{outline:2px solid Highlight;outline-offset:2px;border-radius:8px}.mVp9_thumb{display:block;max-width:320px;max-height:200px;border:1px solid rgba(127,127,127,.35);border-radius:8px;background:0 0;object-fit:contain}.mVp9_lightbox{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);cursor:zoom-out;outline:none}.mVp9_lightbox img{max-width:92vw;max-height:92vh;border-radius:8px;object-fit:contain}";
		const cardCss = ".mVc9_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.mVc9_card:hover{border-color:var(--dsw-alias-label-dimmed)}.mVc9_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.mVc9_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.mVc9_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.mVc9_headerStatic{border-radius:12px;align-items:center;gap:12px;width:100%;padding:14px 16px;display:flex}.mVc9_headText{flex-direction:column;gap:4px;min-width:0;flex:1;display:flex}.mVc9_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.mVc9_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.mVc9_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.mVc9_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.mVc9_chevronOpen{transform:rotate(180deg)}.mVc9_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.mVc9_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.mVc9_notExposed{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-warn,#c07f00));margin:12px 0 0;font-size:12px;line-height:1.5}.mVc9_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.mVc9_failed{min-width:0;color:var(--dsw-alias-label-error);text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0;font-size:12px;line-height:1.5;overflow:hidden}.mVc9_discard,.mVc9_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.mVc9_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.mVc9_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.mVc9_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.mVc9_discard:disabled,.mVc9_save:disabled{opacity:.4;cursor:default}.mVc9_discard:focus-visible,.mVc9_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.mVc9_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.mVc9_field+.mVc9_field{border-top:1px solid var(--dsw-alias-border-l2)}.mVc9_head{align-items:center;gap:8px;display:flex}.mVc9_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.mVc9_badges{align-items:center;gap:8px;display:inline-flex}.mVc9_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.mVc9_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.mVc9_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.mVc9_reset:disabled{cursor:default}.mVc9_reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.mVc9_input,.mVc9_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}.mVc9_input:focus-visible,.mVc9_select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.mVc9_input:disabled,.mVc9_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.mVc9_inputInvalid{border:1px solid var(--dsw-alias-label-error);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}.mVc9_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}.mVc9_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}";
		function injectStyle(tagId, css, plugin) {
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = plugin;
				tag.dataset.pluginCss = tagId;
				tag.textContent = css;
				document.head.appendChild(tag);
			}
		}
		injectStyle("dsh-mmx-vision/preview.module.css", previewCss, "dsh-mmx-vision");
		injectStyle("dsh-mmx-vision/settings-card.module.css", cardCss, "dsh-mmx-vision");
		const previewCssModule = { preview: "mVp9_preview", thumbButton: "mVp9_thumbButton", thumb: "mVp9_thumb", lightbox: "mVp9_lightbox" };
		const cardCssModule = {
			badge: "mVc9_badge", badges: "mVc9_badges", body: "mVc9_body", card: "mVc9_card", cardOpen: "mVc9_cardOpen",
			chevron: "mVc9_chevron", chevronOpen: "mVc9_chevronOpen", description: "mVc9_description", discard: "mVc9_discard",
			failed: "mVc9_failed", field: "mVc9_field", footer: "mVc9_footer", head: "mVc9_head", headText: "mVc9_headText",
			header: "mVc9_header", headerStatic: "mVc9_headerStatic", hint: "mVc9_hint", input: "mVc9_input",
			inputInvalid: "mVc9_inputInvalid", invalid: "mVc9_invalid", label: "mVc9_label", name: "mVc9_name",
			notExposed: "mVc9_notExposed", pending: "mVc9_pending", readOnly: "mVc9_readOnly", reset: "mVc9_reset",
			save: "mVc9_save", select: "mVc9_select"
		};
		//#endregion
		//#region locales
		const NS = "mmx-vision";
		const zh = {
			"card.title": "图像理解（mmx）",
			"card.description": "describe_image 工具调用本地 mmx CLI（MiniMax VLM）理解图像。",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.notExposed": "当前部署未暴露此命名空间，无法在此编辑；可在 ~/.dsh/settings.yaml 的 mmx-vision 节直接配置。",
			"settings.unsaved": "有未保存的修改",
			"settings.readOnly": "当前部署的设置为只读。",
			"settings.saveFailed": "保存失败，请重试。",
			"settings.discard": "放弃修改",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.overridden": "已覆盖",
			"settings.reset": "重置",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.invalidNumber": "需要有效的数字",
			"settings.invalidText": "输入不合法。",
			"field.mmxPath": "mmx 路径",
			"field.mmxPath.hint": "留空自动发现 npm 全局 mmx-cli 的 JS 入口；也可填 mmx-cli 包目录或 bin JS 文件。",
			"field.defaultPrompt": "默认指令",
			"field.defaultPrompt.hint": "调用未带 prompt 参数时的默认指令。",
			"field.maxBytes": "图片字节上限",
			"field.maxBytes.hint": "本地文件与附件的字节上限。",
			"field.timeoutMs": "超时（毫秒）",
			"field.timeoutMs.hint": "单次 mmx 调用超时，默认 180000。",
			"field.renderImagePreview": "会话内渲染图片预览",
			"field.renderImagePreview.hint": "开：会话里的图片引用原地显示为缩略图，点击查看大图；关：保持原始引用文本。仅影响本地显示。",
			"field.interceptImageSend": "发送时改写图片为引用",
			"field.interceptImageSend.hint": "开（默认）：带图片的发送在提交时改写为 mmx-vision 引用；关：原样放行给其他视觉插件。",
			"preview.expand": "点击查看大图",
			"preview.close": "关闭大图"
		};
		const en = {
			"card.title": "Image understanding (mmx)",
			"card.description": "The describe_image tool calls the local mmx CLI (MiniMax VLM).",
			"settings.expand": "Expand settings",
			"settings.collapse": "Hide settings",
			"settings.notExposed": "This deployment does not expose the namespace; edit the mmx-vision section of ~/.dsh/settings.yaml directly.",
			"settings.unsaved": "Unsaved changes",
			"settings.readOnly": "Settings are read-only in this deployment.",
			"settings.saveFailed": "Save failed; try again.",
			"settings.discard": "Discard",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.overridden": "Overridden",
			"settings.reset": "Reset",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.invalidNumber": "A valid number is required",
			"settings.invalidText": "Invalid input.",
			"field.mmxPath": "mmx path",
			"field.mmxPath.hint": "Empty auto-discovers the npm-global mmx-cli JS entry; may also be the mmx-cli package dir or bin JS file.",
			"field.defaultPrompt": "Default instruction",
			"field.defaultPrompt.hint": "Used when a call omits its prompt parameter.",
			"field.maxBytes": "Max image bytes",
			"field.maxBytes.hint": "Byte bound for local files and attachments.",
			"field.timeoutMs": "Timeout (ms)",
			"field.timeoutMs.hint": "Per-call mmx timeout, default 180000.",
			"field.renderImagePreview": "Render image preview in chat",
			"field.renderImagePreview.hint": "On: image references upgrade into inline thumbnails (click for full size). Off: raw reference text stays. Display-only.",
			"field.interceptImageSend": "Rewrite image sends into references",
			"field.interceptImageSend.hint": "On (default): image-bearing sends are rewritten into mmx-vision references at submit. Off: sends pass through to other vision plugins.",
			"preview.expand": "Click to view full size",
			"preview.close": "Close full image"
		};
		const dictionaries = { zh: zh, en: en };
		let currentLanguage = "zh";
		function setLanguage(language) {
			currentLanguage = language;
		}
		function t(key, params) {
			const table = dictionaries[currentLanguage] ?? zh;
			const template = table[key] ?? zh[key];
			if (params === undefined) return template;
			return template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
		}
		//#endregion
		//#region attach client
		const ATTACH_ENDPOINT = "/mmx-vision/attach";
		function readFileAsBase64(file) {
			return new Promise((resolve) => {
				const reader = new FileReader();
				reader.onerror = () => resolve({ ok: false, message: "read-failed" });
				reader.onload = () => {
					const result = typeof reader.result === "string" ? reader.result : "";
					const comma = result.indexOf(",");
					if (comma < 0) {
						resolve({ ok: false, message: "read-failed" });
						return;
					}
					resolve({ ok: true, base64: result.slice(comma + 1) });
				};
				reader.readAsDataURL(file);
			});
		}
		async function uploadImageForMmx(base64, mediaType, name) {
			let response;
			try {
				response = await fetch(ATTACH_ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ data: base64, mediaType: mediaType, ...(name === undefined ? {} : { name: name }) })
				});
			} catch {
				return { ok: false, message: "network-failed" };
			}
			let envelope;
			try {
				envelope = await response.json();
			} catch {
				return { ok: false, message: "bad-response" };
			}
			const record = envelope;
			if (typeof record !== "object" || record === null) return { ok: false, message: "bad-response" };
			if (record.ok === true && typeof record.value === "object" && record.value !== null) {
				const value = record.value;
				if (typeof value.note === "string" && value.note !== "") {
					return { ok: true, note: value.note, markdown: typeof value.markdown === "string" ? value.markdown : value.note };
				}
				return { ok: false, message: "bad-response" };
			}
			const message = record.error?.message;
			return { ok: false, message: typeof message === "string" && message !== "" ? message : "server-failed" };
		}
		//#endregion
		//#region send hook
		const HOOK_MARKER = "__dshMmxVisionSendHooked";
		function installSendHook(conversation, isEnabled) {
			const face = conversation;
			if (face === null || typeof face !== "object") return;
			if (typeof face.sendSession !== "function") return;
			if (typeof face.draftImages !== "function" || typeof face.releaseDraftImage !== "function") return;
			if (face[HOOK_MARKER] === true) return;
			const original = face.sendSession;
			face.sendSession = async function (session, text, imageIds, mode) {
				if (isEnabled !== undefined && !isEnabled()) {
					return original.call(face, session, text, imageIds, mode);
				}
				if (imageIds.length === 0) {
					return original.call(face, session, text, imageIds, mode);
				}
				const attachments = face.draftImages(imageIds);
				if (attachments.length !== imageIds.length) {
					return original.call(face, session, text, imageIds, mode);
				}
				const refs = [];
				for (const attachment of attachments) {
					const read = await readFileAsBase64(attachment.file);
					if (!read.ok) break;
					const upload = await uploadImageForMmx(read.base64, attachment.file.type, attachment.file.name);
					if (!upload.ok) break;
					refs.push(upload.markdown);
				}
				if (refs.length !== attachments.length) {
					return original.call(face, session, text, imageIds, mode);
				}
				const fullText = [text.trim(), ...refs].filter((part) => part !== "").join("\n");
				const result = await session.prompt([{ type: "text", text: fullText }], mode);
				if (!result.ok) {
					throw new Error("conversation.send failed: " + (result.error?.code ?? "unknown") + ": " + (result.error?.message ?? ""));
				}
				for (const id of imageIds) face.releaseDraftImage(id);
			};
			face[HOOK_MARKER] = true;
		}
		//#endregion
		//#region preview
		const REFERENCE_PATTERN = /!\[([^\]]*)]\((\/mmx-vision\/raw\/[^)\s]+)\)/g;
		const CONVERSATION_ROOT_SELECTOR = '[data-slot="conversation.session"]';
		const PREVIEW_ATTR = "data-dsh-mmxv-preview";
		const LIGHTBOX_ATTR = "data-dsh-mmxv-lightbox";
		const MAX_FAILED_PATHS = 200;
		function findImageReferences(text) {
			const matches = [];
			REFERENCE_PATTERN.lastIndex = 0;
			for (let match = REFERENCE_PATTERN.exec(text); match !== null; match = REFERENCE_PATTERN.exec(text)) {
				matches.push({ alt: match[1] ?? "", path: match[2] ?? "", start: match.index, end: match.index + match[0].length });
			}
			return matches;
		}
		function installConversationImagePreview(isEnabled, root) {
			const failedPaths = new Set();
			let lightboxCleanup;
			let contentObserver;
			let mountObserver;
			let observedRoot;
			let disposed = false;
			let scheduled = false;
			const isExcluded = (node) => {
				const parent = node.parentElement;
				if (parent === null) return true;
				return parent.closest("input, textarea, script, style, [contenteditable], [" + PREVIEW_ATTR + "]") !== null;
			};
			const rememberFailure = (path) => {
				if (failedPaths.size >= MAX_FAILED_PATHS) {
					const oldest = failedPaths.values().next();
					if (oldest.done !== true) failedPaths.delete(oldest.value);
				}
				failedPaths.add(path);
			};
			const restorePreview = (preview) => {
				const source = preview.getAttribute(PREVIEW_ATTR);
				if (source === null) return;
				preview.replaceWith(document.createTextNode(source));
			};
			const scope = () => root ?? observedRoot;
			const restoreAll = () => {
				const within = scope();
				if (within === undefined) return;
				for (const preview of within.querySelectorAll("[" + PREVIEW_ATTR + "]")) restorePreview(preview);
			};
			const closeLightbox = () => {
				if (lightboxCleanup !== undefined) lightboxCleanup();
				lightboxCleanup = undefined;
			};
			const openLightbox = (src, alt, trigger) => {
				closeLightbox();
				const overlay = document.createElement("div");
				overlay.className = previewCssModule.lightbox ?? "";
				overlay.setAttribute(LIGHTBOX_ATTR, "");
				overlay.setAttribute("role", "dialog");
				overlay.setAttribute("aria-modal", "true");
				overlay.setAttribute("aria-label", t("preview.close"));
				overlay.tabIndex = -1;
				const image = document.createElement("img");
				image.src = src;
				image.alt = alt;
				overlay.append(image);
				overlay.addEventListener("click", closeLightbox);
				overlay.addEventListener("keydown", (event) => {
					if (event.key === "Escape") closeLightbox();
				});
				lightboxCleanup = () => {
					overlay.remove();
					if (trigger.isConnected) trigger.focus({ preventScroll: true });
				};
				document.body.append(overlay);
				overlay.focus();
			};
			const buildPreview = (match, source) => {
				const preview = document.createElement("span");
				preview.className = previewCssModule.preview ?? "";
				preview.setAttribute(PREVIEW_ATTR, source);
				const button = document.createElement("button");
				button.type = "button";
				button.className = previewCssModule.thumbButton ?? "";
				button.title = t("preview.expand");
				button.setAttribute("aria-label", t("preview.expand"));
				const image = document.createElement("img");
				image.className = previewCssModule.thumb ?? "";
				image.src = window.location.origin + match.path;
				image.alt = match.alt;
				image.addEventListener("error", () => {
					rememberFailure(match.path);
					restorePreview(preview);
				}, { once: true });
				button.addEventListener("click", () => openLightbox(image.src, match.alt, button));
				button.append(image);
				preview.append(button);
				return preview;
			};
			const enhanceNode = (node) => {
				const matches = findImageReferences(node.data).filter((match) => !failedPaths.has(match.path));
				if (matches.length === 0) return;
				const text = node.data;
				const fragment = document.createDocumentFragment();
				let cursor = 0;
				for (const match of matches) {
					fragment.append(document.createTextNode(text.slice(cursor, match.start)));
					fragment.append(buildPreview(match, text.slice(match.start, match.end)));
					cursor = match.end;
				}
				fragment.append(document.createTextNode(text.slice(cursor)));
				node.replaceWith(fragment);
			};
			const scanNode = (node) => {
				if (node.nodeType === Node.TEXT_NODE) {
					const text = node;
					if (text.data.includes("/mmx-vision/raw/") && !isExcluded(text)) enhanceNode(text);
					return;
				}
				if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
					acceptNode: (candidate) => {
						const text = candidate;
						if (!text.data.includes("/mmx-vision/raw/")) return NodeFilter.FILTER_REJECT;
						return isExcluded(text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
					}
				});
				const targets = [];
				while (walker.nextNode()) targets.push(walker.currentNode);
				for (const target of targets) enhanceNode(target);
			};
			const enhanceAll = () => {
				const within = scope();
				if (within !== undefined) scanNode(within);
			};
			const onContentRecords = (records) => {
				if (disposed || !isEnabled()) return;
				for (const record of records) {
					if (record.type === "characterData") {
						scanNode(record.target);
					} else {
						for (const node of record.addedNodes) scanNode(node);
					}
				}
			};
			const attach = () => {
				const next = root ?? document.querySelector(CONVERSATION_ROOT_SELECTOR) ?? undefined;
				if (next === observedRoot) return;
				if (contentObserver !== undefined) contentObserver.disconnect();
				observedRoot = next;
				if (observedRoot !== undefined) {
					contentObserver = new MutationObserver(onContentRecords);
					contentObserver.observe(observedRoot, { childList: true, subtree: true, characterData: true });
					if (isEnabled()) enhanceAll();
				}
			};
			const schedule = () => {
				if (scheduled || disposed) return;
				scheduled = true;
				queueMicrotask(() => {
					scheduled = false;
					if (!disposed) attach();
				});
			};
			const apply = () => {
				if (disposed) return;
				if (isEnabled()) {
					attach();
					enhanceAll();
				} else {
					restoreAll();
				}
			};
			if (root === undefined) {
				mountObserver = new MutationObserver(schedule);
				mountObserver.observe(document.body, { childList: true, subtree: true });
			}
			attach();
			return {
				refresh: apply,
				dispose: () => {
					disposed = true;
					if (mountObserver !== undefined) mountObserver.disconnect();
					if (contentObserver !== undefined) contentObserver.disconnect();
					restoreAll();
					closeLightbox();
				}
			};
		}
		//#endregion
		//#region settings card
		function PluginSettingsCard(props) {
			const [open, setOpen] = useState(props.defaultOpen ?? true);
			const { state } = props;
			if (!state.available) return null;
			const title = t("card.title");
			const description = t("card.description");
			const blocked = !state.dirty || state.invalid || state.saving;
			const expanded = open;
			const cardClass = expanded ? cardCssModule.cardOpen + " " + cardCssModule.card : cardCssModule.card;
			const headText = h("span", { className: cardCssModule.headText },
				h("span", { className: cardCssModule.name, title: title }, title),
				h("span", { className: cardCssModule.description, title: description }, description));
			const pending = state.dirty ? h("span", { className: cardCssModule.pending, title: t("settings.unsaved") }, t("settings.unsaved")) : null;
			const header = h("button", {
				type: "button", className: cardCssModule.header, "aria-expanded": open,
				"aria-label": t(open ? "settings.collapse" : "settings.expand") + ": " + title,
				onClick: () => { setOpen(!open); }
			}, headText, pending,
				h("svg", { width: "14", height: "14", viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg", className: open ? cardCssModule.chevron + " " + cardCssModule.chevronOpen : cardCssModule.chevron },
					h("path", { d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z", fill: "currentColor" })));
			if (!state.exposed) return h("li", { className: cardClass }, header,
				expanded ? h("div", { className: cardCssModule.body }, h("p", { className: cardCssModule.notExposed, role: "status" }, t("settings.notExposed"))) : null);
			return h("li", { className: cardClass }, header,
				expanded ? h("div", { className: cardCssModule.body },
					!state.writable ? h("p", { className: cardCssModule.readOnly, role: "status" }, t("settings.readOnly")) : null,
					props.children,
					h("div", { className: cardCssModule.footer },
						state.failed ? h("p", { className: cardCssModule.failed, role: "status" }, t("settings.saveFailed"), state.failedReason ? " - " + state.failedReason : "") : null,
						h("button", { type: "button", className: cardCssModule.discard, disabled: !state.dirty || state.saving, onClick: props.onDiscard }, t("settings.discard")),
						h("button", { type: "button", className: cardCssModule.save, disabled: blocked, onClick: props.onSave }, t(state.saving ? "settings.saving" : "settings.save")))) : null);
		}
		function ValueField(props) {
			return h("div", { className: cardCssModule.field },
				h("div", { className: cardCssModule.head },
					h("label", { className: cardCssModule.label, htmlFor: props.id }, props.label),
					props.overridden ? h("span", { className: cardCssModule.badges },
						h("span", { className: cardCssModule.badge }, t("settings.overridden")),
						h("button", { type: "button", className: cardCssModule.reset, disabled: props.disabled, onClick: props.onReset }, t("settings.reset"))) : null),
				h("input", {
					id: props.id, type: "text",
					className: props.invalid ? cardCssModule.inputInvalid : cardCssModule.input,
					...(props.invalid ? { "aria-invalid": true } : {}),
					value: props.text, placeholder: props.placeholder ?? "", disabled: props.disabled,
					onChange: (event) => { props.onEdit(event.target.value); }
				}),
				h("p", { className: props.invalid ? cardCssModule.invalid : cardCssModule.hint }, props.invalid ? props.invalidLabel : props.hint));
		}
		function BooleanField(props) {
			return h("div", { className: cardCssModule.field },
				h("div", { className: cardCssModule.head },
					h("label", { className: cardCssModule.label, htmlFor: props.id }, props.label),
					props.overridden ? h("span", { className: cardCssModule.badges },
						h("span", { className: cardCssModule.badge }, t("settings.overridden")),
						h("button", { type: "button", className: cardCssModule.reset, disabled: props.disabled, onClick: props.onReset }, t("settings.reset"))) : null),
				h("select", {
					id: props.id, className: cardCssModule.select, value: props.text, disabled: props.disabled,
					onChange: (event) => { props.onEdit(event.target.value); }
				},
					h("option", { value: "" }, t("settings.inherit")),
					h("option", { value: "true" }, t("settings.on")),
					h("option", { value: "false" }, t("settings.off"))),
				h("p", { className: cardCssModule.hint }, props.hint));
		}
		function stringField(field) {
			return {
				field: field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					return { kind: "set", value: trimmed };
				}
			};
		}
		function numberField(field, constraints) {
			const integer = constraints?.integer ?? false;
			const min = constraints?.min;
			return {
				field: field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					const parsed = Number(trimmed);
					if (!Number.isFinite(parsed)) return void 0;
					if (integer && !Number.isInteger(parsed)) return void 0;
					if (min !== undefined && parsed < min) return void 0;
					return { kind: "set", value: parsed };
				}
			};
		}
		function booleanField(field) {
			return {
				field: field,
				format: (value) => typeof value === "boolean" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true") return { kind: "set", value: true };
					if (trimmed === "false") return { kind: "set", value: false };
					return void 0;
				}
			};
		}
		var CardForm = class {
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.staged = new Map();
				this.listeners = new Set();
				this.saving = false;
				this.failed = false;
				this.failedReason = void 0;
				this.disposed = false;
				this.disposeScope = scope.subscribe(() => { this.publish(); });
			}
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.disposeScope();
				this.listeners.clear();
			}
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
				this.listeners.add(() => { store.set(project()); });
				return store;
			}
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status !== "loading",
					exposed: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed,
					...(this.failedReason === void 0 ? {} : { failedReason: this.failedReason })
				};
			}
			field(field) {
				const spec = this.specOf(field);
				const staged = this.staged.get(field);
				if (staged === void 0) return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return { text: staged.text, overridden: write !== void 0 && write.kind === "set", invalid: write === void 0 };
			}
			actions() {
				return {
					edit: (field, text) => { this.stage(field, { text: text, clear: false }); },
					resetField: (field) => { this.stage(field, { text: this.specOf(field).format(this.baseValue(field)), clear: true }); },
					save: () => { this.save(); },
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.failedReason = void 0;
						this.publish();
					}
				};
			}
			async save() {
				const plan = this.plan();
				const valid = plan.filter((item) => item.run !== void 0);
				if (plan.length === 0 || this.saving || valid.length !== plan.length) return;
				const fields = new Set(plan.map((item) => item.field));
				this.saving = true;
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
				const landed = new Set();
				const batch = typeof this.scope?.mutate === "function" ? this.scope : void 0;
				if (batch !== void 0) {
					const result = await batch.mutate(valid.map((item) => item.op));
					if (result.ok) {
						for (const field of result.fields) if (field.landed) landed.add(field.field);
					} else this.failedReason = result.message;
				} else {
					for (const item of valid) if (await item.run()) landed.add(item.field);
				}
				for (const field of fields) if (landed.has(field)) this.staged.delete(field);
				this.saving = false;
				this.failed = landed.size !== fields.size;
				this.publish();
			}
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const spec = this.specOf(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({ field: field, op: { field: field, op: "unset" }, run: () => this.clear(field) });
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({ field: field, op: { field: field, op: "unset" }, run: void 0 });
					else if (write.kind === "clear") plan.push({ field: field, op: { field: field, op: "unset" }, run: () => this.clear(field) });
					else plan.push({ field: field, op: { field: field, op: "set", value: write.value }, run: () => this.store(field, write.value) });
				}
				return plan;
			}
			async clear(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				return this.userLayer()?.[field] === value;
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
			}
			specOf(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error("settings card has no field " + field);
				return spec;
			}
			sectionValue(field) { return this.scope.getSnapshot().value?.[field]; }
			baseValue(field) { return this.scope.getSnapshot().base?.[field]; }
			userLayer() { return this.scope.getSnapshot().user; }
			stored(field) { const user = this.userLayer(); return user !== void 0 && Object.hasOwn(user, field); }
			publish() { for (const listener of this.listeners) listener(); }
		};
		const FIELDS = [
			stringField("mmxPath"),
			stringField("defaultPrompt"),
			numberField("maxBytes", { integer: true, min: 1 }),
			numberField("timeoutMs", { integer: true, min: 1 }),
			booleanField("renderImagePreview"),
			booleanField("interceptImageSend"),
		];
		var MmxVisionSettingsCardController = class {
			constructor(scope) {
				this.form = new CardForm(scope, FIELDS);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				const projection = { ...this.form.shell() };
				for (const spec of FIELDS) projection[spec.field] = this.form.field(spec.field);
				return projection;
			}
			inject() {
				return { hooks: { mmxVisionSettingsCard: this.store }, ...this.form.actions() };
			}
			dispose() { this.form.dispose(); }
		};
		function MmxVisionSettingsCard(props) {
			const state = props.useMmxVisionSettingsCard((snapshot) => snapshot);
			const disabled = !state.writable;
			const fieldProps = { overriddenLabel: t("settings.overridden"), resetLabel: t("settings.reset"), invalidLabel: t("settings.invalidText"), disabled: disabled };
			const booleanExtras = { inheritLabel: t("settings.inherit"), onLabel: t("settings.on"), offLabel: t("settings.off") };
			const boolean = (field, labelKey, hintKey) => h(BooleanField, {
				id: "mmx-vision-" + field, label: t(labelKey), hint: t(hintKey),
				...booleanExtras, ...fieldProps, ...state[field],
				onEdit: (text) => { props.edit(field, text); },
				onReset: () => { props.resetField(field); }
			});
			const value = (field, labelKey, hintKey, placeholder, numeric) => h(ValueField, {
				id: "mmx-vision-" + field, label: t(labelKey), hint: t(hintKey), placeholder: placeholder, numeric: numeric,
				...fieldProps, ...state[field],
				onEdit: (text) => { props.edit(field, text); },
				onReset: () => { props.resetField(field); }
			});
			return h(PluginSettingsCard, {
				state: state, onSave: props.save, onDiscard: props.discard
			},
				value("mmxPath", "field.mmxPath", "field.mmxPath.hint", ""),
				value("defaultPrompt", "field.defaultPrompt", "field.defaultPrompt.hint", ""),
				value("maxBytes", "field.maxBytes", "field.maxBytes.hint", "", true),
				value("timeoutMs", "field.timeoutMs", "field.timeoutMs.hint", "", true),
				boolean("renderImagePreview", "field.renderImagePreview", "field.renderImagePreview.hint"),
				boolean("interceptImageSend", "field.interceptImageSend", "field.interceptImageSend.hint"));
		}
		//#endregion
		//#region apply
		const inject = ["slots", "conversation", "settingsScope", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), "dsh-mmx-vision: dictionaries");
			ctx.effect(() => {
				const sync = () => {
					const lang = document.documentElement.lang;
					setLanguage(lang === "zh" || (lang ?? "").startsWith("zh-") ? "zh" : "en");
				};
				sync();
				const observer = new MutationObserver(sync);
				observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
				return () => observer.disconnect();
			}, "dsh-mmx-vision: language mirror");
			ctx.inject(["slots", "conversation"], () => {
				const conversation = ctx.conversation;
				const slots = ctx.slots;
				let settingsScopeRef;
				let unsubscribeSettings;
				installSendHook(conversation, () => settingsScopeRef?.getSnapshot().value?.interceptImageSend !== false);
				let previewRef;
				ctx.effect(() => {
					const handle = installConversationImagePreview(() => settingsScopeRef?.getSnapshot().value?.renderImagePreview !== false);
					previewRef = handle;
					return () => {
						previewRef = void 0;
						unsubscribeSettings?.();
						unsubscribeSettings = void 0;
						settingsScopeRef = void 0;
						handle.dispose();
					};
				}, "dsh-mmx-vision: conversation image preview");
				ctx.inject(["settingsScope"], () => {
					const binder = ctx.get("webUiSettings") ?? ctx.settingsScope;
					const settingsScope = binder.bind({ namespace: "mmx-vision" });
					unsubscribeSettings?.();
					settingsScopeRef = settingsScope;
					unsubscribeSettings = settingsScope.subscribe(() => previewRef?.refresh());
					const controller = new MmxVisionSettingsCardController(settingsScope);
					slots.inject("web-ui.plugin.item", () => {
						const unregister = slots.register({
							name: "web-ui.plugin.item",
							id: "mmx-vision",
							order: 116,
							locale: NS,
							inject: () => controller.inject()
						}, MmxVisionSettingsCard);
						return () => {
							controller.dispose();
							unregister();
						};
					});
				});
			});
		}
		//#endregion
		exports.MmxVisionSettingsCard = MmxVisionSettingsCard;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = "mmx-vision";
		return module.exports;
	}
});
