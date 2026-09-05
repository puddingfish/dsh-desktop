/**
 * DSH 模型路由插件（browser 半边）：独立侧边栏入口「模型路由」+ 全屏配置视图。
 * 侧边栏挂载与视图接管模式移植自 dsh-web-ui 家族（Apache-2.0，dsh-ssh /
 * dsh-client-ui-task-board 同款）；保存走 settingsScope（与原设置卡片同一机制）。
 * provider / 模型下拉的数据来自 host 半边 GET /model-router/models。
 * @module dsh-model-router/client
 */

window.__ModuleLoader__.load({
	id: "dsh-model-router",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-store");
		const h = react.createElement;
		const useState = react.useState;
		const useSyncExternalStore = react.useSyncExternalStore;
		//#region client css
		const css = [
			/* 会话列接管（照家族模式：激活时隐藏会话内容、显示本视图） */
			"[data-pane=conversation],[class*=centerCol]{position:relative}",
			"[data-dsh-modelrouter-view]{z-index:60;background:var(--dsw-alias-bg-base);display:none;position:absolute;inset:0;overflow:auto}",
			"html[data-dsh-modelrouter-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-modelrouter-view]{display:block}",
			"html[data-dsh-modelrouter-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane=conversation]>:not([data-dsh-modelrouter-view]),html[data-dsh-modelrouter-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*=centerCol]>:not([data-dsh-modelrouter-view]){display:none!important}",
			/* 侧边栏入口 */
			".mrVw_entry{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex}",
			".mrVw_entry:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}",
			".mrVw_entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:600}",
			".mrVw_entryIcon{flex:none;justify-content:center;align-items:center;display:inline-flex}",
			".mrVw_entryLabel{text-overflow:ellipsis;overflow:hidden}",
			"[data-dsh-frame][data-sidebar-collapsed] .mrVw_entry{justify-content:center;width:100%;padding:0}",
			"[data-dsh-frame][data-sidebar-collapsed] .mrVw_entryLabel{display:none}",
			/* 配置视图 */
			".mrVw_page{margin:0 auto;max-width:860px;min-width:0;padding:20px 24px 40px;flex-direction:column;gap:14px;display:flex}",
			".mrVw_head{align-items:center;gap:10px;display:flex}",
			".mrVw_back{color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:4px;padding:6px 10px;font-size:13px;display:inline-flex}",
			".mrVw_back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".mrVw_title{color:var(--dsw-alias-label-primary);flex:1;white-space:nowrap;margin:0;font-size:16px;font-weight:700}",
			".mrVw_sub{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:1.5}",
			".mrVw_defaultRow{align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:10px 14px;font-size:13px;display:flex}",
			".mrVw_defaultLabel{color:var(--dsw-alias-label-tertiary);flex:none}",
			".mrVw_defaultValue{color:var(--dsw-alias-label-primary);font-weight:600}",
			".mrVw_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s;flex-direction:column;display:flex}",
			".mrVw_cardHead{align-items:center;gap:10px;padding:14px 16px;display:flex}",
			".mrVw_cardTitle{color:var(--dsw-alias-label-primary);flex:1;min-width:0;font-size:15px;font-weight:600}",
			".mrVw_cardHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
			".mrVw_cardBody{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;margin:0 16px;padding:14px 0 8px;display:flex}",
			".mrVw_field{flex-direction:column;gap:6px;display:flex}",
			".mrVw_fieldHead{align-items:center;gap:8px;display:flex}",
			".mrVw_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}",
			".mrVw_badges{align-items:center;gap:6px;display:flex}",
			".mrVw_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
			".mrVw_reset{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:2px 6px;font-size:11px}",
			".mrVw_reset:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".mrVw_select,.mrVw_input{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;width:100%;padding:8px 10px;font:inherit;font-size:13px}",
			".mrVw_select:focus,.mrVw_input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}",
			".mrVw_rowFields{grid-template-columns:1fr 1fr;gap:12px;display:grid}",
			"@media (max-width: 640px){.mrVw_rowFields{grid-template-columns:1fr}}",
			".mrVw_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
			".mrVw_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
			".mrVw_failed{min-width:0;color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-error,#d33));text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0;font-size:12px;line-height:1.5;overflow:hidden}",
			".mrVw_saved{min-width:0;color:var(--dsw-alias-state-success-primary,#2a2);flex:1;margin:0;font-size:12px;line-height:1.5}",
			".mrVw_discard{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 16px;font-size:13px}",
			".mrVw_discard:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".mrVw_discard:disabled,.mrVw_save:disabled{cursor:default;opacity:.5}",
			".mrVw_save{color:var(--dsw-alias-label-primary-inverted);cursor:pointer;background:var(--dsw-alias-button-primary-fill);border:0;border-radius:8px;padding:7px 20px;font-size:13px;font-weight:500}",
			".mrVw_save:hover{background:var(--dsw-alias-button-primary-hover)}",
			".mrVw_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
			".mrVw_loading{color:var(--dsw-alias-label-tertiary);padding:30px 0;text-align:center;font-size:13px}",
		].join("");
		const tagId = "dsh-model-router/view.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-model-router";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region locales
		const NS = "dsh-model-router";
		const zh = {
			"entry.label": "模型路由",
			"entry.tooltip": "按任务类型自动选择模型（省成本）",
			"view.title": "模型路由",
			"view.subtitle": "按任务类型自动选择模型：简单任务走便宜模型，复杂任务走强模型。子代理与关键词规则可分别指定。",
			"view.back": "返回会话",
			"view.defaultLabel": "全局默认模型",
			"view.defaultUnknown": "未知",
			"view.loading": "正在加载配置…",
			"view.catalogFallback": "未能读取已配置的模型列表（{reason}），provider / 模型改为手动输入。",
			"toggle.enabled": "启用路由",
			"toggle.enabledHint": "关闭后所有请求保持原模型，不做任何改写。",
			"toggle.respectExplicit": "尊重显式选择",
			"toggle.respectExplicitHint": "会话里手动选过模型、或任务显式指定模型时不干预。",
			"toggle.inherit": "跟随全局",
			"toggle.on": "开",
			"toggle.off": "关",
			"group.main": "主会话",
			"group.mainHint": "未命中任何规则时的基础路由。留空 = 不改写主会话模型。",
			"group.subagent": "子代理",
			"group.subagentHint": "后台委派任务（subagent）使用的模型。后台研究/独立小任务走便宜模型是主要省钱点。",
			"group.light": "轻量规则",
			"group.lightHint": "命中关键词 → 便宜模型。对当前待处理的用户消息做关键词匹配。",
			"group.heavy": "重型规则",
			"group.heavyHint": "命中关键词 → 强模型。未命中轻量规则时才检查。",
			"field.provider": "Provider",
			"field.model": "模型",
			"field.keywords": "关键词",
			"field.keywordsHint": "逗号或换行分隔，命中任一即路由。",
			"field.unset": "（不路由）",
			"field.customOption": "（手动）{value}",
			"field.unknownProvider": "（未在已配置列表中）",
			"field.manualModelHint": "provider 未知，手动输入模型 id。",
			"field.modelHint": "从 {provider} 的模型列表中选择。",
			"field.overridden": "已覆盖",
			"field.reset": "恢复默认",
			"action.save": "保存",
			"action.saving": "保存中…",
			"action.discard": "放弃",
			"action.saved": "已保存",
			"action.unsaved": "未保存",
			"action.saveFailed": "部署未接受这些值，已保留供你修改。",
			"toggle.enabledLabel": "启用轻量规则",
			"toggle.enabledLabelHeavy": "启用重型规则",
		};
		const en = {
			"entry.label": "Model Router",
			"entry.tooltip": "Route tasks to cheaper or stronger models automatically",
			"view.title": "Model Router",
			"view.subtitle": "Route requests to cheaper or stronger models by task type: cheap models for simple tasks, strong models for heavy ones. Subagents and keyword rules are configurable separately.",
			"view.back": "Back to conversation",
			"view.defaultLabel": "Global default model",
			"view.defaultUnknown": "unknown",
			"view.loading": "Loading configuration…",
			"view.catalogFallback": "Could not load the configured model list ({reason}); provider / model fall back to manual input.",
			"toggle.enabled": "Enable routing",
			"toggle.enabledHint": "When off, every request keeps its original model.",
			"toggle.respectExplicit": "Respect explicit selection",
			"toggle.respectExplicitHint": "Skip rewriting when the session or task already pinned a model.",
			"toggle.inherit": "Follow global",
			"toggle.on": "On",
			"toggle.off": "Off",
			"group.main": "Main conversation",
			"group.mainHint": "Base route when no rule matches. Empty = leave the model untouched.",
			"group.subagent": "Subagents",
			"group.subagentHint": "Model for delegated background tasks. Routing them to a cheap model is the biggest saving.",
			"group.light": "Light rule",
			"group.lightHint": "Keyword hit → cheap model, matched against the pending user message.",
			"group.heavy": "Heavy rule",
			"group.heavyHint": "Keyword hit → strong model. Checked only when the light rule did not match.",
			"field.provider": "Provider",
			"field.model": "Model",
			"field.keywords": "Keywords",
			"field.keywordsHint": "Comma or newline separated; any hit routes.",
			"field.unset": "(no routing)",
			"field.customOption": "(manual) {value}",
			"field.unknownProvider": "(not in configured providers)",
			"field.manualModelHint": "Provider unknown; type the model id manually.",
			"field.modelHint": "Pick from {provider}'s model list.",
			"field.overridden": "Overridden",
			"field.reset": "Reset to default",
			"action.save": "Save",
			"action.saving": "Saving…",
			"action.discard": "Discard",
			"action.saved": "Saved",
			"action.unsaved": "Unsaved",
			"action.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"toggle.enabledLabel": "Enable light rule",
			"toggle.enabledLabelHeavy": "Enable heavy rule",
		};
		/** 当前语言取词（按文档语言即时取，与家族插件一致）。 */
		function makeT() {
			const isEn = (typeof document !== "undefined" ? document.documentElement.lang : "zh").toLowerCase().startsWith("en");
			const dict = isEn ? en : zh;
			return (key, params) => {
				let text = dict[key] ?? zh[key] ?? key;
				if (params !== undefined) for (const [k, v] of Object.entries(params)) text = text.split("{" + k + "}").join(String(v));
				return text;
			};
		}
		//#endregion
		//#region settings-form（暂存式表单：草稿、校验、保存/放弃）
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
		var CardForm = class {
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.staged = new Map();
				this.listeners = new Set();
				this.saving = false;
				this.failed = false;
				this.failedReason = void 0;
				this.savedFlash = false;
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
					savedFlash: this.savedFlash,
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
				this.savedFlash = false;
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
				this.savedFlash = landed.size === fields.size;
				this.publish();
				if (this.savedFlash) setTimeout(() => { this.savedFlash = false; this.publish(); }, 2500);
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
				this.savedFlash = false;
				this.publish();
			}
			specOf(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error("settings form has no field " + field);
				return spec;
			}
			sectionValue(field) { return this.scope.getSnapshot().value?.[field]; }
			baseValue(field) { return this.scope.getSnapshot().base?.[field]; }
			userLayer() { return this.scope.getSnapshot().user; }
			stored(field) { const user = this.userLayer(); return user !== void 0 && Object.hasOwn(user, field); }
			publish() { for (const listener of this.listeners) listener(); }
		};
		//#endregion
		//#region fields（下拉版字段组件）
		/** 布尔三态字段：跟随全局 / 开 / 关。 */
		function BooleanField(props) {
			return h("div", { className: "mrVw_field" },
				h("div", { className: "mrVw_fieldHead" },
					h("label", { className: "mrVw_label", htmlFor: props.id }, props.label),
					props.overridden ? h("span", { className: "mrVw_badges" },
						h("span", { className: "mrVw_badge" }, props.overriddenLabel),
						h("button", { type: "button", className: "mrVw_reset", disabled: props.disabled, onClick: props.onReset }, props.resetLabel)) : null),
				h("select", {
					id: props.id, className: "mrVw_select", value: props.text, disabled: props.disabled,
					onChange: (event) => { props.onEdit(event.target.value); }
				},
					h("option", { value: "" }, props.inheritLabel),
					h("option", { value: "true" }, props.onLabel),
					h("option", { value: "false" }, props.offLabel)),
				h("p", { className: "mrVw_hint" }, props.hint));
		}
		/** 关键词文本字段。 */
		function KeywordsField(props) {
			return h("div", { className: "mrVw_field" },
				h("div", { className: "mrVw_fieldHead" },
					h("label", { className: "mrVw_label", htmlFor: props.id }, props.label),
					props.overridden ? h("span", { className: "mrVw_badges" },
						h("span", { className: "mrVw_badge" }, props.overriddenLabel),
						h("button", { type: "button", className: "mrVw_reset", disabled: props.disabled, onClick: props.onReset }, props.resetLabel)) : null),
				h("input", {
					id: props.id, type: "text", className: "mrVw_input",
					value: props.text, placeholder: props.placeholder ?? "", disabled: props.disabled,
					onChange: (event) => { props.onEdit(event.target.value); }
				}),
				h("p", { className: "mrVw_hint" }, props.hint));
		}
		/**
		 * Provider 下拉：选项 = （不路由）+ 已配置 provider 目录 + 当前值兜底。
		 * catalog 为空（API 不可用）时降级为文本输入。
		 */
		function ProviderField(props) {
			const head = h("div", { className: "mrVw_fieldHead" },
				h("label", { className: "mrVw_label", htmlFor: props.id }, props.label),
				props.overridden ? h("span", { className: "mrVw_badges" },
					h("span", { className: "mrVw_badge" }, props.overriddenLabel),
					h("button", { type: "button", className: "mrVw_reset", disabled: props.disabled, onClick: props.onReset }, props.resetLabel)) : null);
			if (props.catalog.length === 0) {
				return h("div", { className: "mrVw_field" }, head,
					h("input", {
						id: props.id, type: "text", className: "mrVw_input",
						value: props.text, placeholder: props.placeholder ?? "", disabled: props.disabled,
						onChange: (event) => { props.onEdit(event.target.value); }
					}),
					h("p", { className: "mrVw_hint" }, props.hint));
			}
			const known = new Set(props.catalog.map((p) => p.id));
			const custom = props.text !== "" && !known.has(props.text);
			return h("div", { className: "mrVw_field" }, head,
				h("select", {
					id: props.id, className: "mrVw_select", value: props.text, disabled: props.disabled,
					onChange: (event) => { props.onEdit(event.target.value); }
				},
					h("option", { value: "" }, props.unsetLabel),
					props.catalog.map((p) => h("option", { key: p.id, value: p.id }, p.displayName === p.id ? p.id : p.displayName + " (" + p.id + ")")),
					custom ? h("option", { value: props.text }, (props.customLabel ?? "").replace("{value}", props.text)) : null),
				h("p", { className: "mrVw_hint" }, custom ? props.unknownHint : props.hint));
		}
		/**
		 * 模型下拉：选项 = （不路由）+ 所选 provider 的模型列表 + 当前值兜底。
		 * provider 未知 / 无模型列表时降级为文本输入。
		 */
		function ModelField(props) {
			const head = h("div", { className: "mrVw_fieldHead" },
				h("label", { className: "mrVw_label", htmlFor: props.id }, props.label),
				props.overridden ? h("span", { className: "mrVw_badges" },
					h("span", { className: "mrVw_badge" }, props.overriddenLabel),
					h("button", { type: "button", className: "mrVw_reset", disabled: props.disabled, onClick: props.onReset }, props.resetLabel)) : null);
			const entry = props.catalog.find((p) => p.id === props.provider);
			if (entry === undefined || entry.models.length === 0) {
				return h("div", { className: "mrVw_field" }, head,
					h("input", {
						id: props.id, type: "text", className: "mrVw_input",
						value: props.text, placeholder: props.placeholder ?? "", disabled: props.disabled || props.provider === "",
						onChange: (event) => { props.onEdit(event.target.value); }
					}),
					h("p", { className: "mrVw_hint" }, props.manualHint));
			}
			const known = new Set(entry.models.map((m) => m.id));
			const custom = props.text !== "" && !known.has(props.text);
			return h("div", { className: "mrVw_field" }, head,
				h("select", {
					id: props.id, className: "mrVw_select", value: props.text, disabled: props.disabled,
					onChange: (event) => { props.onEdit(event.target.value); }
				},
					h("option", { value: "" }, props.unsetLabel),
					entry.models.map((m) => h("option", { key: m.id, value: m.id }, m.name !== undefined && m.name !== m.id ? m.name + " (" + m.id + ")" : m.id)),
					custom ? h("option", { value: props.text }, (props.customLabel ?? "").replace("{value}", props.text)) : null),
				h("p", { className: "mrVw_hint" }, custom ? props.unknownHint : (props.hint ?? "").replace("{provider}", props.provider)));
		}
		//#endregion
		//#region catalog（provider/模型目录获取）
		/** 拉取 host 侧 provider/模型目录；失败返回 {providers: [], error}。 */
		async function fetchCatalog() {
			try {
				const response = await fetch("/model-router/models", { cache: "no-store" });
				if (!response.ok) return { providers: [], error: "HTTP " + response.status };
				const envelope = await response.json();
				if (envelope?.ok !== true || !Array.isArray(envelope.value?.providers)) {
					return { providers: [], error: "bad envelope" };
				}
				return {
					providers: envelope.value.providers,
					default: envelope.value.default,
					current: envelope.value.current,
				};
			} catch (error) {
				return { providers: [], error: error?.message ?? String(error) };
			}
		}
		//#endregion
		//#region view（全屏配置页）
		const FIELDS = [
			booleanField("enabled"),
			booleanField("respectExplicit"),
			stringField("mainProvider"), stringField("mainModel"),
			stringField("subagentProvider"), stringField("subagentModel"),
			booleanField("lightEnabled"), stringField("lightKeywords"),
			stringField("lightProvider"), stringField("lightModel"),
			booleanField("heavyEnabled"), stringField("heavyKeywords"),
			stringField("heavyProvider"), stringField("heavyModel"),
		];
		/** useSyncExternalStore 订阅 CardForm 的投影 store。 */
		function useFormSnapshot(store) {
			return useSyncExternalStore(
				(callback) => store.subscribe(callback),
				() => store.getSnapshot(),
			);
		}
		/** 一组 provider+model 路由卡片（主会话/子代理/轻量/重型共用）。 */
		function RouteCard(props) {
			const t = props.t;
			const state = props.state;
			const disabled = !state.writable;
			const fieldProps = {
				overriddenLabel: t("field.overridden"),
				resetLabel: t("field.reset"),
				unsetLabel: t("field.unset"),
				customLabel: t("field.customOption"),
				unknownHint: t("field.unknownProvider"),
				disabled: disabled,
			};
			const providerField = (field, labelKey) => h(ProviderField, {
				id: "model-router-" + field, label: t(labelKey), hint: t(props.hintKey),
				placeholder: "codely", catalog: props.catalog,
				...fieldProps, ...state[field],
				onEdit: (text) => { props.edit(field, text); },
				onReset: () => { props.resetField(field); }
			});
			const modelField = (providerField_, field, labelKey) => h(ModelField, {
				id: "model-router-" + field, label: t(labelKey),
				hint: t("field.modelHint", { provider: state[providerField_].text || "?" }),
				manualHint: t("field.manualModelHint"),
				placeholder: "GLM-5.3", catalog: props.catalog,
				provider: state[providerField_].text,
				...fieldProps, ...state[field],
				onEdit: (text) => { props.edit(field, text); },
				onReset: () => { props.resetField(field); }
			});
			return h("section", { className: "mrVw_card" },
				h("div", { className: "mrVw_cardHead" },
					h("h2", { className: "mrVw_cardTitle" }, t(props.titleKey)),
					props.toggleField !== undefined && state[props.toggleField] !== undefined ? h("span", { className: "mrVw_pending" }, state[props.toggleField].text === "true" ? t("toggle.on") : state[props.toggleField].text === "false" ? t("toggle.off") : t("toggle.inherit")) : null),
				h("div", { className: "mrVw_cardBody" },
					props.toggleField !== undefined ? h(BooleanField, {
						id: "model-router-" + props.toggleField, label: props.toggleLabel, hint: props.toggleHint,
						inheritLabel: t("toggle.inherit"), onLabel: t("toggle.on"), offLabel: t("toggle.off"),
						...fieldProps, ...state[props.toggleField],
						onEdit: (text) => { props.edit(props.toggleField, text); },
						onReset: () => { props.resetField(props.toggleField); }
					}) : null,
					props.keywordsField !== undefined ? h(KeywordsField, {
						id: "model-router-" + props.keywordsField, label: t("field.keywords"), hint: t("field.keywordsHint"),
						placeholder: props.keywordsPlaceholder,
						overriddenLabel: t("field.overridden"), resetLabel: t("field.reset"), disabled: disabled,
						...state[props.keywordsField],
						onEdit: (text) => { props.edit(props.keywordsField, text); },
						onReset: () => { props.resetField(props.keywordsField); }
					}) : null,
					h("div", { className: "mrVw_rowFields" },
						providerField(props.providerField, "field.provider"),
						modelField(props.providerField, props.modelField, "field.model")),
					h("p", { className: "mrVw_cardHint" }, t(props.hintKey))));
		}
		/** 全屏配置页。 */
		function ModelRouterView(props) {
			const t = props.t;
			const state = useFormSnapshot(props.store);
			const actions = props.actions;
			const [catalog, setCatalog] = useState({ providers: [], loaded: false, error: undefined });
			// 挂载时拉一次目录（含 default / current）
			react.useEffect(() => {
				let alive = true;
				fetchCatalog().then((result) => {
					if (alive) setCatalog({
						providers: result.providers,
						loaded: true,
						error: result.error,
						default: result.default,
					});
				});
				return () => { alive = false; };
			}, []);
			if (!state.available) {
				return h("div", { className: "mrVw_page" },
					h("div", { className: "mrVw_head" },
						h("button", { type: "button", className: "mrVw_back", onClick: props.onBack }, "← " + t("view.back")),
						h("h1", { className: "mrVw_title" }, t("view.title"))),
					h("p", { className: "mrVw_loading" }, t("view.loading")));
			}
			const disabled = !state.writable;
			const fieldProps = {
				overriddenLabel: t("field.overridden"),
				resetLabel: t("field.reset"),
				unsetLabel: t("field.unset"),
				customLabel: t("field.customOption"),
				unknownHint: t("field.unknownProvider"),
				disabled: disabled,
			};
			const defaultModel = catalog.default !== undefined
				? catalog.default.provider + " / " + catalog.default.model
				: t("view.defaultUnknown");
			return h("div", { className: "mrVw_page" },
				h("div", { className: "mrVw_head" },
					h("button", { type: "button", className: "mrVw_back", onClick: props.onBack }, "← " + t("view.back")),
					h("h1", { className: "mrVw_title" }, t("view.title")),
					state.dirty ? h("span", { className: "mrVw_pending" }, t("action.unsaved")) : null),
				h("p", { className: "mrVw_sub" }, t("view.subtitle")),
				catalog.loaded && catalog.error !== undefined ? h("p", { className: "mrVw_hint" }, t("view.catalogFallback", { reason: catalog.error })) : null,
				h("div", { className: "mrVw_defaultRow" },
					h("span", { className: "mrVw_defaultLabel" }, t("view.defaultLabel") + "："),
					h("span", { className: "mrVw_defaultValue" }, defaultModel)),
				h("section", { className: "mrVw_card" },
					h("div", { className: "mrVw_cardHead" }, h("h2", { className: "mrVw_cardTitle" }, t("toggle.enabled"))),
					h("div", { className: "mrVw_cardBody" },
						h(BooleanField, {
							id: "model-router-enabled", label: t("toggle.enabled"), hint: t("toggle.enabledHint"),
							inheritLabel: t("toggle.inherit"), onLabel: t("toggle.on"), offLabel: t("toggle.off"),
							...fieldProps, ...state.enabled,
							onEdit: (text) => { actions.edit("enabled", text); },
							onReset: () => { actions.resetField("enabled"); }
						}),
						h(BooleanField, {
							id: "model-router-respectExplicit", label: t("toggle.respectExplicit"), hint: t("toggle.respectExplicitHint"),
							inheritLabel: t("toggle.inherit"), onLabel: t("toggle.on"), offLabel: t("toggle.off"),
							...fieldProps, ...state.respectExplicit,
							onEdit: (text) => { actions.edit("respectExplicit", text); },
							onReset: () => { actions.resetField("respectExplicit"); }
						}))),
				h(RouteCard, { t: t, state: state, actions: actions, catalog: catalog.providers,
					titleKey: "group.main", hintKey: "group.mainHint",
					providerField: "mainProvider", modelField: "mainModel",
					edit: actions.edit, resetField: actions.resetField }),
				h(RouteCard, { t: t, state: state, actions: actions, catalog: catalog.providers,
					titleKey: "group.subagent", hintKey: "group.subagentHint",
					providerField: "subagentProvider", modelField: "subagentModel",
					edit: actions.edit, resetField: actions.resetField }),
				h(RouteCard, { t: t, state: state, actions: actions, catalog: catalog.providers,
					titleKey: "group.light", hintKey: "group.lightHint",
					providerField: "lightProvider", modelField: "lightModel",
					toggleField: "lightEnabled", toggleLabel: t("toggle.enabledLabel"), toggleHint: t("group.lightHint"),
					keywordsField: "lightKeywords", keywordsPlaceholder: "总结, 写文档, 翻译",
					edit: actions.edit, resetField: actions.resetField }),
				h(RouteCard, { t: t, state: state, actions: actions, catalog: catalog.providers,
					titleKey: "group.heavy", hintKey: "group.heavyHint",
					providerField: "heavyProvider", modelField: "heavyModel",
					toggleField: "heavyEnabled", toggleLabel: t("toggle.enabledLabelHeavy"), toggleHint: t("group.heavyHint"),
					keywordsField: "heavyKeywords", keywordsPlaceholder: "重构, 架构, 调试",
					edit: actions.edit, resetField: actions.resetField }),
				h("div", { className: "mrVw_footer" },
					state.failed ? h("p", { className: "mrVw_failed", role: "status" }, t("action.saveFailed"), state.failedReason ? " - " + state.failedReason : "") : null,
					!state.failed && state.savedFlash ? h("p", { className: "mrVw_saved", role: "status" }, t("action.saved")) : null,
					h("button", { type: "button", className: "mrVw_discard", disabled: !state.dirty || state.saving, onClick: actions.discard }, t("action.discard")),
					h("button", { type: "button", className: "mrVw_save", disabled: !state.dirty || state.invalid || state.saving, onClick: actions.save }, t(state.saving ? "action.saving" : "action.save"))));
		}
		//#endregion
		//#region sidebar entry（家族模式：DOM 挂载 + 自愈）
		/** 侧边栏根：logoRow 父级（当前 shell）或 sidebar 列首子元素。 */
		function sidebarRoot() {
			const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
			if (column === null) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
		}
		/** 新会话按钮（嵌套于 logoRow 或直接子级，兼容旧 shell）。 */
		function newSessionButton(root) {
			const nested = root.querySelector("button[class*=\"newSession\"]");
			if (nested !== null) return nested;
			for (const child of root.children) if (child.tagName === "BUTTON") return child;
		}
		/** 兄弟插件已挂的入口（保持家族排序稳定）。 */
		const ENTRY_FAMILY = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-modelrouter-entry]";
		/** 构造入口按钮（分离 DOM，shell 就绪后插入）。 */
		function createEntry(controller, t) {
			const entry = document.createElement("button");
			entry.type = "button";
			entry.dataset.dshModelrouterEntry = "";
			entry.setAttribute("aria-label", t("entry.label"));
			entry.setAttribute("title", t("entry.tooltip"));
			entry.innerHTML = "<span class=\"mrVw_entryIcon\"><svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"3\" cy=\"4\" r=\"1.6\"/><circle cx=\"3\" cy=\"12\" r=\"1.6\"/><circle cx=\"13\" cy=\"8\" r=\"1.6\"/><path d=\"M4.4 4.6h3.2a2 2 0 0 1 2 2v.4M4.5 11.4h3.1a2 2 0 0 0 2-2v-.4\"/></svg></span><span class=\"mrVw_entryLabel\">" + t("entry.label") + "</span>";
			entry.addEventListener("click", () => { controller.toggle(); });
			return entry;
		}
		/** 插到新会话行之后（家族条目之后），保持顺序稳定。 */
		function placeEntry(root, entry) {
			const button = newSessionButton(root);
			if (button === void 0) return false;
			if (entry.parentElement !== root) {
				const row = button.closest("[class*=\"logoRow\"]");
				const base = row !== null && row.parentElement === root ? row : button;
				const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(ENTRY_FAMILY));
				const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
				root.insertBefore(entry, anchor);
			}
			return true;
		}
		/** 自愈挂载：等 shell 渲染 + React 重挂后回插。 */
		function mountSidebarEntry(controller, t) {
			const entry = createEntry(controller, t);
			entry.className = "mrVw_entry";
			let root;
			let placed = false;
			const tryPlace = () => {
				if (root !== void 0 && !root.isConnected) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				if (placed) {
					if (document.body.contains(entry)) return;
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				root ??= sidebarRoot();
				if (root === void 0) return;
				placed = placeEntry(root, entry);
				if (placed) rootObserver.observe(root, { childList: true, subtree: true });
			};
			const waitObserver = new MutationObserver(() => { tryPlace(); });
			waitObserver.observe(document.body, { childList: true, subtree: true });
			const rootObserver = new MutationObserver(() => {
				if (root === void 0 || !root.isConnected) {
					placed = false;
					tryPlace();
					return;
				}
				if (!root.contains(entry)) placed = placeEntry(root, entry);
			});
			const syncActive = () => {
				if (controller.getSnapshot().panelOpen) entry.dataset.active = "true";
				else delete entry.dataset.active;
			};
			const unsubscribe = controller.subscribe(syncActive);
			syncActive();
			tryPlace();
			return () => {
				waitObserver.disconnect();
				rootObserver.disconnect();
				unsubscribe();
				entry.remove();
			};
		}
		//#endregion
		//#region panel mount（会话列接管）
		const CONVERSATION_COLUMN_SELECTOR = "[data-pane=\"conversation\"], [class*=\"centerCol\"]";
		const ACTIVE_ATTR = "data-dsh-modelrouter-active";
		const ACTIVATE_EVENT = "dsh-panel-activate";
		const PANEL_NAME = "modelrouter";
		const SIDEBAR_ROW_SELECTOR = "[class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
		function conversationColumn() {
			return document.querySelector(CONVERSATION_COLUMN_SELECTOR) ?? void 0;
		}
		/**
		 * 把配置视图挂进会话列（React 根），激活状态绑 controller.panelOpen。
		 * @returns disposer 卸载视图并还原会话列。
		 */
		function mountPanel(controller, deps) {
			let root;
			let container;
			const ensure = () => {
				if (container !== void 0) {
					if (container.isConnected) return;
					root?.unmount();
					root = void 0;
					container.remove();
					container = void 0;
				}
				const column = conversationColumn();
				if (column === void 0) return;
				container = document.createElement("div");
				container.dataset.dshModelrouterView = "";
				column.appendChild(container);
				root = (0, react_dom_client.createRoot)(container);
				root.render(h(ModelRouterView, {
					t: deps.t,
					store: deps.store,
					actions: deps.actions,
					onBack: () => { controller.close(); },
				}));
			};
			const waitObserver = new MutationObserver(() => { ensure(); });
			waitObserver.observe(document.body, { childList: true, subtree: true });
			const applyActive = () => {
				if (controller.getSnapshot().panelOpen) {
					document.documentElement.setAttribute(ACTIVE_ATTR, "");
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
				} else document.documentElement.removeAttribute(ACTIVE_ATTR);
			};
			const onOtherActivate = (event) => {
				if (event.detail !== PANEL_NAME && controller.getSnapshot().panelOpen) controller.close();
			};
			const onClickSidebarRow = (event) => {
				if (!controller.getSnapshot().panelOpen) return;
				const target = event.target;
				if (target === null) return;
				if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close();
			};
			document.addEventListener("click", onClickSidebarRow, true);
			document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
			const unsubscribe = controller.subscribe(applyActive);
			applyActive();
			ensure();
			return () => {
				document.removeEventListener("click", onClickSidebarRow, true);
				document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
				waitObserver.disconnect();
				unsubscribe();
				root?.unmount();
				container?.remove();
				document.documentElement.removeAttribute(ACTIVE_ATTR);
			};
		}
		//#endregion
		//#region panel controller
		var PanelController = class {
			panelOpen = false;
			listeners = new Set();
			getSnapshot() { return { panelOpen: this.panelOpen }; }
			subscribe(fn) {
				this.listeners.add(fn);
				return () => { this.listeners.delete(fn); };
			}
			open() {
				if (this.panelOpen) return;
				this.panelOpen = true;
				this.notify();
			}
			close() {
				if (!this.panelOpen) return;
				this.panelOpen = false;
				this.notify();
			}
			toggle() {
				if (this.panelOpen) this.close();
				else this.open();
			}
			notify() {
				for (const fn of [...this.listeners]) fn();
			}
		};
		//#endregion
		//#region apply
		/** 需要的客户端服务：设置 scope（保存）与多语言。 */
		const inject = ["settingsScope", "locale"];
		/** 应用浏览器半边：独立侧边栏入口 + 全屏配置视图。 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), "model-router: dictionaries");
			ctx.inject(["settingsScope"], () => {
				const t = makeT();
				const binder = ctx.get("webUiSettings") ?? ctx.settingsScope;
				const controller = new PanelController();
				const form = new CardForm(binder.bind({ namespace: "model-router" }), FIELDS);
				const projectView = () => {
					const projection = { ...form.shell() };
					for (const spec of FIELDS) projection[spec.field] = form.field(spec.field);
					return projection;
				};
				const store = form.bind(projectView);
				const actions = form.actions();
				store.set(projectView());
				const disposers = [];
				try {
					disposers.push(mountSidebarEntry(controller, t));
					disposers.push(mountPanel(controller, { t: t, store: store, actions: actions }));
				} catch (error) {
					console.warn("[model-router] mount failed:", error);
				}
				ctx.effect(() => () => {
					for (const dispose of disposers.splice(0)) dispose();
					form.dispose();
				}, "model-router: ui mounts");
			});
		}
		//#endregion
		exports.ModelRouterView = ModelRouterView;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = "model-router";
		return module.exports;
	}
});
