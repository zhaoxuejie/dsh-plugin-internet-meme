(function() {
	//#region src/settings.ts
	const defaults = {
		enabled: true,
		density: "normal",
		fontSize: "normal",
		opacity: 86,
		blur: "soft",
		theme: "classic",
		customLines: "",
		colorMode: "event",
		showIcons: true,
		maxVisible: 4,
		diagnostics: false,
		soundEnabled: false,
		soundMode: "status",
		soundVolume: 55
	};
	/** Validate persisted settings, including valid JSON with incorrect field types. */
	function normalizeSettings(value) {
		const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
		const choice = (key, allowed, fallback) => typeof data[key] === "string" && allowed.includes(data[key]) ? data[key] : fallback;
		const boolean = (key, fallback) => typeof data[key] === "boolean" ? data[key] : fallback;
		return {
			enabled: boolean("enabled", defaults.enabled),
			density: choice("density", [
				"quiet",
				"normal",
				"busy"
			], defaults.density),
			fontSize: choice("fontSize", [
				"small",
				"normal",
				"large"
			], defaults.fontSize),
			opacity: typeof data.opacity === "number" && Number.isFinite(data.opacity) ? Math.round(Math.min(100, Math.max(35, data.opacity))) : defaults.opacity,
			blur: choice("blur", [
				"none",
				"soft",
				"strong"
			], defaults.blur),
			theme: choice("theme", [
				"classic",
				"workplace",
				"anime",
				"cyber",
				"custom"
			], defaults.theme),
			customLines: typeof data.customLines === "string" ? data.customLines.slice(0, 20100).split(/\r?\n/).map((line) => line.trim().slice(0, 200)).filter(Boolean).slice(0, 100).join("\n") : "",
			colorMode: choice("colorMode", ["event", "mono"], defaults.colorMode),
			showIcons: boolean("showIcons", defaults.showIcons),
			maxVisible: typeof data.maxVisible === "number" && [
				3,
				4,
				5
			].includes(data.maxVisible) ? data.maxVisible : defaults.maxVisible,
			diagnostics: boolean("diagnostics", defaults.diagnostics),
			soundEnabled: boolean("soundEnabled", defaults.soundEnabled),
			soundMode: choice("soundMode", ["status", "announce"], defaults.soundMode),
			soundVolume: typeof data.soundVolume === "number" && Number.isFinite(data.soundVolume) ? Math.round(Math.min(100, Math.max(0, data.soundVolume))) : defaults.soundVolume
		};
	}
	//#endregion
	//#region src/queue.ts
	function enqueue(queue, next) {
		const last = queue.at(-1);
		const sameToolCall = next.kind === "tool-call" && !!next.callId && !!next.toolName && last?.callId === next.callId && last.toolName === next.toolName;
		if (!next.previewId && !last?.previewId && last?.kind === next.kind && (next.kind === "step-start" || sameToolCall)) last.repeat += next.repeat;
		else if (next.previewId) queue.unshift(next);
		else queue.push(next);
		while (queue.length > 8) {
			const disposable = queue.findIndex((item) => !item.previewId && item.kind !== "turn-end" && item.failed !== true);
			queue.splice(disposable >= 0 ? disposable : 0, 1);
		}
	}
	//#endregion
	//#region src/bridge.ts
	(() => {
		const ROOT_ID = "dsh-internet-meme-overlay";
		const SETTINGS_ID = "dsh-internet-meme-settings";
		const SETTINGS_NAV_ID = "dsh-internet-meme-settings-nav";
		const SETTINGS_PANE_ID = "dsh-internet-meme-settings-pane";
		const PREVIEW_PATH = "/plugins/dsh-plugin-internet-meme/preview";
		const STORAGE_KEY = "dsh-plugin-internet-meme.settings.v2";
		const pulseVisuals = {
			"turn-start": {
				icon: "💭",
				tone: "think"
			},
			"step-start": {
				icon: "🧠",
				tone: "think"
			},
			"tool-call": {
				icon: "🛠️",
				tone: "tool"
			},
			"tool-result": {
				icon: "✨",
				tone: "result"
			},
			"turn-end": {
				icon: "✅",
				tone: "done"
			}
		};
		const themes = {
			classic: {
				label: "经典热梗",
				lines: {
					"turn-start": ["脑力涡轮已启动", "CPU 预热中，别急"],
					"step-start": ["再推演一轮，稳住别慌", "思路正在展开"],
					"tool-call": ["准备调用 {tool}，希望不要翻车", "{tool} 出动，查一下线索"],
					"tool-result": ["{tool} 返回了，线索到手", "{tool} 已交卷，继续推进"],
					"turn-end": ["本轮结束", "这一轮先告一段落"]
				}
			},
			workplace: {
				label: "职场摸鱼",
				lines: {
					"turn-start": ["工位灯亮了，开始加班式思考", "老板路过，假装很忙"],
					"step-start": ["再开一个脑内会议", "方案正在走审批流程"],
					"tool-call": ["请 {tool} 同事支援一下", "{tool}，这份活交给你了"],
					"tool-result": ["{tool} 回消息了，继续跟进", "{tool} 已回执，项目没黄"],
					"turn-end": ["本轮工作告一段落", "这一轮会议结束了"]
				}
			},
			anime: {
				label: "二次元燃系",
				lines: {
					"turn-start": ["思考之力，启动！", "大脑领域展开"],
					"step-start": ["下一回合推理开始", "线索正在觉醒"],
					"tool-call": ["召唤 {tool}！", "{tool}，拜托你了！"],
					"tool-result": ["{tool} 带回了关键情报", "{tool} 的力量到账"],
					"turn-end": ["这一回合结束", "本轮落幕，未完待续"]
				}
			},
			cyber: {
				label: "赛博终端",
				lines: {
					"turn-start": ["神经网络接入中…", "推理核心开始升温"],
					"step-start": ["新一轮计算已排队", "数据流正在重组"],
					"tool-call": ["执行模块：{tool}", "向 {tool} 发起请求"],
					"tool-result": ["{tool} 回传数据包", "{tool} 校验完成"],
					"turn-end": ["本轮任务流已关闭", "当前回合结束"]
				}
			}
		};
		const toolNames = /* @__PURE__ */ new Map();
		const settingsSections = /* @__PURE__ */ new Set();
		let settings = loadSettings();
		let root;
		let lane;
		let live;
		let memeSettingsOpen = false;
		const laneReadyAt = [
			0,
			0,
			0
		];
		const pendingMemes = [];
		let queueTimer;
		let storageWarning = "";
		let previewStatus = "";
		let previewPending;
		let audioContext;
		let lastSoundAt = 0;
		function loadSettings() {
			try {
				return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
			} catch {
				return { ...defaults };
			}
		}
		function random(items) {
			return items[Math.floor(Math.random() * items.length)];
		}
		function applyVisualSettings() {
			if (!root) return;
			root.dataset.enabled = String(settings.enabled);
			root.dataset.density = settings.density;
			root.dataset.font = settings.fontSize;
			root.dataset.colorMode = settings.colorMode;
			root.style.setProperty("--meme-opacity", String(settings.opacity / 100));
			root.style.setProperty("--meme-blur", settings.blur === "none" ? "0px" : settings.blur === "soft" ? "1px" : "2.5px");
		}
		function updateFeedback() {
			for (const section of settingsSections) {
				const storage = section.querySelector(".dsh-meme-storage-status");
				const preview = section.querySelector(".dsh-meme-preview-status");
				const button = section.querySelector(".dsh-meme-preview-button");
				if (storage && storage.textContent !== storageWarning) storage.textContent = storageWarning;
				if (preview && preview.textContent !== previewStatus) preview.textContent = previewStatus;
				if (button) button.disabled = !!previewPending;
			}
		}
		function saveSettings(render = true) {
			settings = normalizeSettings(settings);
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
				storageWarning = "";
			} catch {
				storageWarning = "设置已在本页生效，但无法保存；刷新后可能恢复原设置。";
			}
			applyVisualSettings();
			if (!render) {
				updateFeedback();
				return;
			}
			for (const section of settingsSections) if (section.isConnected) renderSettingsSection(section);
			else settingsSections.delete(section);
		}
		function mount() {
			if (document.getElementById(ROOT_ID)) return;
			root = document.createElement("div");
			root.id = ROOT_ID;
			lane = document.createElement("div");
			lane.className = "dsh-meme-lane";
			live = document.createElement("div");
			live.className = "dsh-meme-live";
			live.setAttribute("aria-live", "polite");
			root.append(lane, live);
			document.body.append(root);
			applyVisualSettings();
		}
		function messageFor(pulse) {
			if (pulse.kind === "tool-call" && pulse.callId) toolNames.set(pulse.callId, pulse.toolName || "工具");
			const tool = pulse.toolName || (pulse.callId ? toolNames.get(pulse.callId) : void 0) || "工具";
			if (pulse.kind === "tool-result" && pulse.failed === true) return `${tool} 执行失败，请查看工具状态`;
			if (pulse.kind === "tool-result" && pulse.failed !== false) return `${tool} 已返回，请查看工具状态`;
			const custom = settings.customLines.split("\n").map((line) => line.trim()).filter(Boolean);
			return random(settings.theme === "custom" && custom.length ? custom : themes[settings.theme]?.lines[pulse.kind] || themes.classic.lines[pulse.kind]).replaceAll("{tool}", tool);
		}
		function launchInterval() {
			return settings.density === "quiet" ? 3100 : settings.density === "busy" ? 1700 : 2400;
		}
		function lifetime() {
			return settings.density === "busy" ? 8500 : settings.density === "quiet" ? 12e3 : 10500;
		}
		function scheduleNextMeme() {
			if (!lane || !live || !settings.enabled || !pendingMemes.length) return;
			const now = Date.now();
			const laneIndex = laneReadyAt.reduce((earliest, readyAt, index) => readyAt < laneReadyAt[earliest] ? index : earliest, 0);
			const delay = laneReadyAt[laneIndex] - now;
			if (delay > 0) {
				if (queueTimer) window.clearTimeout(queueTimer);
				queueTimer = window.setTimeout(scheduleNextMeme, delay);
				return;
			}
			const next = pendingMemes.shift();
			if (!next) return;
			while (lane.firstElementChild && lane.children.length >= settings.maxVisible) lane.firstElementChild.remove();
			const visual = next.failed === true ? {
				icon: "⚠️",
				tone: "error"
			} : pulseVisuals[next.kind];
			const item = document.createElement("div");
			item.className = `dsh-meme-item dsh-meme-tone-${visual.tone}`;
			item.style.setProperty("--meme-x", `${[
				0,
				54,
				108
			][laneIndex]}px`);
			if (settings.showIcons) {
				const icon = document.createElement("span");
				icon.className = "dsh-meme-item-icon";
				icon.textContent = visual.icon;
				item.append(icon);
			}
			const copy = document.createElement("span");
			copy.className = "dsh-meme-item-copy";
			copy.textContent = next.repeat > 1 ? `${next.message} × ${next.repeat}` : next.message;
			item.append(copy);
			lane.append(item);
			live.textContent = copy.textContent;
			if (next.previewId) {
				const confirmVisible = () => {
					const pending = previewPending;
					if (!pending || pending.id !== next.previewId) return;
					const style = getComputedStyle(item);
					if (settings.enabled && item.isConnected && document.visibilityState === "visible" && Number(style.opacity) > 0 && item.getBoundingClientRect().height > 0) {
						pending.rendered = true;
						completePreview();
					} else window.requestAnimationFrame(confirmVisible);
				};
				window.requestAnimationFrame(confirmVisible);
			}
			laneReadyAt[laneIndex] = now + launchInterval();
			window.setTimeout(() => item.remove(), lifetime());
			if (pendingMemes.length) window.setTimeout(scheduleNextMeme, 0);
		}
		function show(message, pulse) {
			if (!settings.enabled) return;
			enqueue(pendingMemes, {
				...pulse,
				message,
				repeat: 1
			});
			scheduleNextMeme();
		}
		/** Sound derives only from event category and never speaks session content. */
		function soundIsAllowed() {
			return settings.enabled && settings.soundEnabled && settings.soundVolume > 0 && document.visibilityState === "visible" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
		}
		async function unlockAudio() {
			if (!soundIsAllowed()) return;
			audioContext ??= new AudioContext();
			if (audioContext.state !== "running") await audioContext.resume();
		}
		function soundFor(pulse) {
			if (pulse.kind === "tool-result" && pulse.failed === true) return {
				frequency: 180,
				type: "sawtooth"
			};
			if (pulse.kind === "turn-end") return {
				frequency: 659,
				type: "triangle"
			};
			if (pulse.kind === "tool-result") return {
				frequency: 740,
				type: "sine"
			};
			if (pulse.kind === "tool-call") return {
				frequency: 520,
				type: "sine"
			};
			return {
				frequency: 420,
				type: "sine"
			};
		}
		function announceFor(pulse) {
			if (settings.soundMode !== "announce" || !("speechSynthesis" in window) || window.speechSynthesis.speaking) return;
			const message = pulse.kind === "tool-result" && pulse.failed === true ? "工具执行失败" : pulse.kind === "turn-end" ? "本轮结束" : void 0;
			if (!message) return;
			const utterance = new SpeechSynthesisUtterance(message);
			utterance.lang = "zh-CN";
			utterance.rate = 1.1;
			utterance.volume = settings.soundVolume / 100;
			window.speechSynthesis.speak(utterance);
		}
		function playAudioFeedback(pulse) {
			if (!soundIsAllowed() || Date.now() - lastSoundAt < 2200) return;
			lastSoundAt = Date.now();
			unlockAudio().then(() => {
				if (!audioContext || !soundIsAllowed()) return;
				const context = audioContext, sound = soundFor(pulse), oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
				oscillator.type = sound.type;
				oscillator.frequency.setValueAtTime(sound.frequency, now);
				gain.gain.setValueAtTime(1e-4, now);
				gain.gain.exponentialRampToValueAtTime(Math.max(1e-4, settings.soundVolume / 900), now + .015);
				gain.gain.exponentialRampToValueAtTime(1e-4, now + .16);
				oscillator.connect(gain).connect(context.destination);
				oscillator.start(now);
				oscillator.stop(now + .17);
				announceFor(pulse);
			}).catch(() => {
				if (settings.diagnostics) console.info("[internet-meme] audio unavailable");
			});
		}
		function text(value, className) {
			const node = document.createElement("div");
			node.textContent = value;
			if (className) node.className = className;
			return node;
		}
		function control(label, hint, input) {
			const row = document.createElement("label");
			row.className = "dsh-meme-setting-row";
			const copy = document.createElement("span");
			copy.className = "dsh-meme-setting-copy";
			copy.append(text(label, "dsh-meme-setting-label"), text(hint, "dsh-meme-setting-hint"));
			row.append(copy, input);
			return row;
		}
		function select(value, options, onChange) {
			const node = document.createElement("select");
			node.className = "dsh-meme-select";
			for (const [optionValue, label] of options) {
				const option = document.createElement("option");
				option.value = optionValue;
				option.textContent = label;
				option.selected = optionValue === value;
				node.append(option);
			}
			node.addEventListener("change", () => onChange(node.value));
			return node;
		}
		function checkbox(checked, onChange) {
			const node = document.createElement("input");
			node.type = "checkbox";
			node.className = "dsh-meme-checkbox";
			node.checked = checked;
			node.addEventListener("change", () => onChange(node.checked));
			return node;
		}
		function previewButton() {
			const node = document.createElement("button");
			node.type = "button";
			node.className = "dsh-meme-preview-button";
			node.textContent = "预览弹幕";
			node.disabled = !!previewPending;
			node.addEventListener("click", runPreview);
			return node;
		}
		function finishPreview(message) {
			const pending = previewPending;
			if (pending) {
				window.clearTimeout(pending.timer);
				pending.controller.abort();
				for (let index = pendingMemes.length - 1; index >= 0; index--) if (pendingMemes[index].previewId === pending.id) pendingMemes.splice(index, 1);
			}
			previewPending = void 0;
			previewStatus = message;
			updateFeedback();
		}
		function completePreview() {
			if (previewPending?.httpOk && previewPending.received && previewPending.rendered) finishPreview("预览成功：事件已接收，字幕已显示。");
		}
		async function runPreview() {
			if (previewPending) return;
			if (!settings.enabled) {
				previewStatus = "请先开启“显示字幕”，再预览。";
				updateFeedback();
				return;
			}
			if (settings.soundEnabled) unlockAudio();
			const id = crypto.randomUUID();
			const controller = new AbortController();
			previewPending = {
				id,
				httpOk: false,
				received: false,
				rendered: false,
				timer: window.setTimeout(() => {
					if (previewPending?.id === id) finishPreview(previewPending.received ? "预览超时：尚未确认请求完成及字幕显示，请保持页面可见后重试。" : "预览超时：未收到对应事件，请检查连接或重启 Web profile。");
				}, 12e3),
				controller
			};
			previewStatus = "正在检查预览链路…";
			updateFeedback();
			try {
				const response = await fetch(PREVIEW_PATH, {
					method: "POST",
					headers: { "X-Meme-Preview-Id": id },
					signal: controller.signal
				});
				if (previewPending?.id !== id) return;
				if (!response.ok) {
					finishPreview("预览失败：HTTP " + response.status + "，请检查插件服务。");
					return;
				}
				previewPending.httpOk = true;
				completePreview();
			} catch {
				if (previewPending?.id === id) finishPreview("预览失败：无法连接插件服务，请检查网络或重启 Web profile。");
			}
		}
		function renderSettingsSection(section) {
			section.replaceChildren();
			section.append(text("热梗字幕", "dsh-meme-settings-title"), text("只影响本浏览器的字幕显示，不进入模型消息流。", "dsh-meme-settings-description"));
			const storageStatus = text(storageWarning, "dsh-meme-storage-status dsh-meme-setting-hint");
			storageStatus.setAttribute("role", "status");
			section.append(storageStatus);
			section.append(control("显示字幕", "关闭后不再显示新的弹幕。", checkbox(settings.enabled, (next) => {
				settings.enabled = next;
				saveSettings();
			})));
			section.append(control("热梗主题", "选择字幕文案的风格。", select(settings.theme, [
				["classic", themes.classic.label],
				["workplace", themes.workplace.label],
				["anime", themes.anime.label],
				["cyber", themes.cyber.label],
				["custom", "自定义文案池"]
			], (next) => {
				settings.theme = next;
				saveSettings();
			})));
			section.append(control("弹幕密度", "决定轨道发射间隔；密度越高，节奏越快。", select(settings.density, [
				["quiet", "安静"],
				["normal", "标准"],
				["busy", "热闹"]
			], (next) => {
				settings.density = next;
				saveSettings();
			})));
			section.append(control("最大同屏条数", "达到上限时移除最早的字幕，避免遮挡。", select(String(settings.maxVisible), [
				["3", "3 条"],
				["4", "4 条"],
				["5", "5 条"]
			], (next) => {
				settings.maxVisible = Number(next);
				saveSettings();
			})));
			section.append(control("弹幕配色", "按事件类型使用颜色，或统一使用克制单色。", select(settings.colorMode, [["event", "按事件配色"], ["mono", "克制单色"]], (next) => {
				settings.colorMode = next;
				saveSettings();
			})));
			section.append(control("显示事件图标", "在文案左侧显示思考、工具和完成状态图标。", checkbox(settings.showIcons, (next) => {
				settings.showIcons = next;
				saveSettings();
			})));
			section.append(control("预览效果", "不调用模型，使用同一条事件流展示一条工具类弹幕。", previewButton()));
			section.append(control("提示音", "默认关闭；页面失焦或系统启用减少动态效果时不播放。", checkbox(settings.soundEnabled, (next) => {
				settings.soundEnabled = next;
				saveSettings();
				if (next) unlockAudio();
			})));
			if (settings.soundEnabled) {
				section.append(control("声音模式", "状态提示音可提示所有事件；朗读只用于失败和本轮结束。", select(settings.soundMode, [["status", "仅状态提示音"], ["announce", "完成与失败时朗读"]], (next) => {
					settings.soundMode = next;
					saveSettings();
				})));
				const soundRange = document.createElement("input");
				soundRange.type = "range";
				soundRange.min = "0";
				soundRange.max = "100";
				soundRange.step = "1";
				soundRange.value = String(settings.soundVolume);
				soundRange.className = "dsh-meme-range dsh-meme-sound-range";
				const soundRow = control(`提示音音量 ${settings.soundVolume}%`, "连续事件至少间隔 2.2 秒；朗读不包含热梗或会话内容。", soundRange);
				soundRange.addEventListener("input", () => {
					settings.soundVolume = Number(soundRange.value);
					soundRow.querySelector(".dsh-meme-setting-label").textContent = `提示音音量 ${settings.soundVolume}%`;
				});
				soundRange.addEventListener("change", () => saveSettings(false));
				section.append(soundRow);
			}
			const previewFeedback = text(previewStatus, "dsh-meme-preview-status dsh-meme-setting-hint");
			previewFeedback.setAttribute("role", "status");
			section.append(previewFeedback);
			section.append(control("字幕字号", "影响右侧上浮字幕的阅读尺寸。", select(settings.fontSize, [
				["small", "小"],
				["normal", "中"],
				["large", "大"]
			], (next) => {
				settings.fontSize = next;
				saveSettings();
			})));
			const range = document.createElement("input");
			range.type = "range";
			range.min = "35";
			range.max = "100";
			range.step = "1";
			range.value = String(settings.opacity);
			range.className = "dsh-meme-range";
			const opacityRow = control(`透明度 ${settings.opacity}%`, "越低越轻，越高越醒目。", range);
			range.addEventListener("input", () => {
				settings.opacity = Number(range.value);
				applyVisualSettings();
				opacityRow.querySelector(".dsh-meme-setting-label").textContent = `透明度 ${settings.opacity}%`;
			});
			range.addEventListener("change", () => saveSettings(false));
			section.append(opacityRow);
			section.append(control("顶部淡出模糊", "字幕上浮到顶部时的虚化程度。", select(settings.blur, [
				["none", "关闭"],
				["soft", "轻柔"],
				["strong", "明显"]
			], (next) => {
				settings.blur = next;
				saveSettings();
			})));
			section.append(control("诊断日志", "仅在浏览器控制台输出事件元数据，可能包含工具名和调用 ID。", checkbox(settings.diagnostics, (next) => {
				settings.diagnostics = next;
				saveSettings();
			})));
			if (settings.theme === "custom") {
				const custom = document.createElement("label");
				custom.className = "dsh-meme-custom";
				custom.append(text("自定义文案池（最多 100 条，每条 200 字符；可用 {tool} 代表工具名；失败与未知结果使用固定提示）", "dsh-meme-setting-label"));
				const area = document.createElement("textarea");
				area.rows = 5;
				area.placeholder = "例如：{tool} 来了，大家让一让";
				area.value = settings.customLines;
				area.addEventListener("change", () => {
					settings.customLines = area.value;
					saveSettings();
				});
				custom.append(area);
				section.append(custom);
			}
		}
		function clearDetachedSettingsSections() {
			for (const section of settingsSections) if (!section.isConnected) settingsSections.delete(section);
		}
		function getNativeOptions(content) {
			return Array.from(content.children).find((child, index) => index > 0 && child.id !== SETTINGS_PANE_ID);
		}
		function restoreNativeSettings(content) {
			content.querySelector(`#${SETTINGS_PANE_ID}`)?.remove();
			const nativeOptions = getNativeOptions(content);
			if (nativeOptions) nativeOptions.style.display = "";
			clearDetachedSettingsSections();
		}
		function showMemeSettings(content) {
			const nativeOptions = getNativeOptions(content);
			if (!nativeOptions) return;
			nativeOptions.style.display = "none";
			if (content.querySelector(`#${SETTINGS_PANE_ID}`)) return;
			const pane = document.createElement("div");
			pane.id = SETTINGS_PANE_ID;
			pane.className = "dsh-meme-settings-pane";
			const section = document.createElement("section");
			section.id = SETTINGS_ID;
			section.className = "dsh-meme-settings";
			settingsSections.add(section);
			renderSettingsSection(section);
			pane.append(section);
			content.append(pane);
		}
		function injectSettingsNavigation() {
			const nav = document.querySelector("[role=\"dialog\"][aria-modal=\"true\"]")?.querySelector("nav");
			const content = nav?.nextElementSibling;
			if (!nav || !content) {
				clearDetachedSettingsSections();
				return;
			}
			const nativeButtons = Array.from(nav.querySelectorAll("button")).filter((button) => button.id !== SETTINGS_NAV_ID);
			const navList = nativeButtons[0]?.parentElement;
			if (!navList) return;
			let memeNav = navList.querySelector(`#${SETTINGS_NAV_ID}`);
			if (!memeNav) {
				memeNav = document.createElement("button");
				memeNav.id = SETTINGS_NAV_ID;
				memeNav.type = "button";
				memeNav.className = `${nativeButtons[0]?.className ?? ""} dsh-meme-nav`;
				memeNav.innerHTML = "<span class=\"dsh-meme-nav-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 11.5a7.5 7.5 0 0 1-8 7.48 7.8 7.8 0 0 1-3.42-.8L4 20l1.45-3.54A7.43 7.43 0 0 1 4.5 12a7.5 7.5 0 0 1 8-7.48 7.5 7.5 0 0 1 7.5 7.48Z\"/><path d=\"M8.5 12h.01M12 12h.01M15.5 12h.01\"/></svg></span><span>热梗字幕</span>";
				memeNav.addEventListener("click", () => {
					memeSettingsOpen = true;
					injectSettingsNavigation();
				});
				navList.append(memeNav);
			}
			for (const button of nativeButtons) {
				if (button.dataset.memeSettingsBound === "true") continue;
				button.dataset.memeSettingsBound = "true";
				button.addEventListener("click", () => {
					memeSettingsOpen = false;
					injectSettingsNavigation();
				});
			}
			memeNav.setAttribute("aria-current", memeSettingsOpen ? "true" : "false");
			memeNav.classList.toggle("dsh-meme-nav-active", memeSettingsOpen);
			if (memeSettingsOpen) {
				for (const button of nativeButtons) {
					button.removeAttribute("aria-current");
					button.classList.add("dsh-meme-native-inactive");
				}
				showMemeSettings(content);
			} else {
				for (const button of nativeButtons) button.classList.remove("dsh-meme-native-inactive");
				restoreNativeSettings(content);
			}
		}
		function installStyles() {
			if (document.getElementById("dsh-internet-meme-styles")) return;
			const style = document.createElement("style");
			style.id = "dsh-internet-meme-styles";
			style.textContent = `
      #${ROOT_ID}{--meme-opacity:.86;--meme-blur:1px;position:fixed;z-index:2147483000;right:18px;bottom:14px;width:min(420px,calc(100vw - 32px));height:min(66vh,620px);pointer-events:none;font-family:ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary,#fff);overflow:hidden}#${ROOT_ID}[data-enabled="false"]{display:none}.dsh-meme-lane{position:relative;width:100%;height:100%}.dsh-meme-item{--meme-accent:#8b7cff;position:absolute;right:var(--meme-x,0px);bottom:6px;display:inline-flex;align-items:center;gap:7px;max-width:calc(100% - var(--meme-x) - 6px);padding:6px 10px;border-radius:999px;background:linear-gradient(115deg,color-mix(in srgb,var(--meme-accent) 17%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-3,#29243a) 90%,transparent));border:1px solid color-mix(in srgb,var(--meme-accent) 54%,transparent);box-shadow:0 8px 28px rgba(0,0,0,.16);font-size:14px;line-height:1.4;white-space:nowrap;overflow:hidden;opacity:0;animation:dshMemeFloat 10.5s linear forwards;will-change:transform,opacity,filter}.dsh-meme-tone-think{--meme-accent:#8b7cff}.dsh-meme-tone-tool{--meme-accent:#f2a93b}.dsh-meme-tone-result{--meme-accent:#35bf9b}.dsh-meme-tone-done{--meme-accent:#ef70ad}.dsh-meme-tone-error{--meme-accent:#e56868}.dsh-meme-storage-status:empty,.dsh-meme-preview-status:empty{display:none}.dsh-meme-preview-button:disabled{opacity:.6;cursor:wait}#${ROOT_ID}[data-color-mode="mono"] .dsh-meme-item{--meme-accent:#9892aa}.dsh-meme-item-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;border-radius:50%;background:color-mix(in srgb,var(--meme-accent) 23%,transparent);font-size:12px;line-height:1}.dsh-meme-item-copy{min-width:0;overflow:hidden;text-overflow:ellipsis}#${ROOT_ID}[data-font="small"] .dsh-meme-item{font-size:12px}#${ROOT_ID}[data-font="large"] .dsh-meme-item{font-size:17px}#${ROOT_ID}[data-density="quiet"] .dsh-meme-item{animation-duration:12s}#${ROOT_ID}[data-density="busy"] .dsh-meme-item{animation-duration:8.5s}.dsh-meme-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}@keyframes dshMemeFloat{0%{opacity:0;transform:translate3d(14px,0,0);filter:blur(0)}8%{opacity:var(--meme-opacity)}70%{opacity:calc(var(--meme-opacity) * .74)}100%{opacity:0;transform:translate3d(-8px,-58vh,0);filter:blur(var(--meme-blur))}}
      .dsh-meme-nav{position:relative;background:transparent!important;border-color:transparent!important}.dsh-meme-nav:hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(118,98,255,.08))!important}.dsh-meme-nav-active{background:var(--dsw-specific-sidebar-nav-item-active,rgba(118,98,255,.16))!important}.dsh-meme-native-inactive{background:transparent!important;border-color:transparent!important}.dsh-meme-nav-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 16px}.dsh-meme-nav-icon svg{width:16px;height:16px}.dsh-meme-settings-pane{box-sizing:border-box;flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}.dsh-meme-settings{box-sizing:border-box;margin:0;padding:18px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-primary,#a9a1d4) 30%,transparent);border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-3,#29243a) 55%,transparent);display:grid;gap:12px}.dsh-meme-settings-title{font-size:16px;font-weight:650;line-height:1.4}.dsh-meme-settings-description,.dsh-meme-setting-hint{color:var(--dsw-alias-label-secondary,#9b96ac);font-size:12px;line-height:1.5}.dsh-meme-setting-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-top:11px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-primary,#a9a1d4) 18%,transparent)}.dsh-meme-setting-copy{display:grid;gap:2px;min-width:0}.dsh-meme-setting-label{font-size:14px;line-height:1.4}.dsh-meme-select,.dsh-meme-preview-button,.dsh-meme-custom textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-primary,#6e6787);border-radius:9px;background:var(--dsw-alias-bg-layer-2,#201d2b);color:var(--dsw-alias-label-primary,#fff);font:inherit;padding:7px 9px}.dsh-meme-select{min-width:120px}.dsh-meme-preview-button{cursor:pointer}.dsh-meme-preview-button:hover{border-color:#7662ff;background:color-mix(in srgb,#7662ff 15%,var(--dsw-alias-bg-layer-2,#201d2b))}.dsh-meme-checkbox{width:18px;height:18px;accent-color:#7662ff}.dsh-meme-range{width:142px;accent-color:#7662ff}.dsh-meme-custom{display:grid;gap:8px;padding-top:11px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-primary,#a9a1d4) 18%,transparent)}.dsh-meme-custom textarea{width:100%;resize:vertical}@media (max-width:700px){#${ROOT_ID}{right:10px;bottom:8px;width:calc(100vw - 20px);height:52vh}.dsh-meme-item{font-size:12px;max-width:96%}.dsh-meme-settings-pane{padding:0 14px 14px}.dsh-meme-setting-row{align-items:flex-start;flex-direction:column;gap:7px}.dsh-meme-select,.dsh-meme-range{width:100%}}
    `;
			document.head.append(style);
		}
		function connect() {
			const source = new EventSource("/plugins/dsh-plugin-internet-meme/events");
			source.onmessage = (event) => {
				try {
					const pulse = JSON.parse(event.data);
					if (!pulse || !Object.hasOwn(pulseVisuals, pulse.kind)) return;
					if (pulse.previewId) {
						if (pulse.previewId !== previewPending?.id) return;
						previewPending.received = true;
					}
					if (settings.diagnostics) console.info("[internet-meme]", pulse);
					show(messageFor(pulse), pulse);
					playAudioFeedback(pulse);
				} catch (error) {
					if (settings.diagnostics) console.warn("[internet-meme] bad pulse", error);
				}
			};
			source.onerror = () => {
				if (settings.diagnostics) console.info("[internet-meme] reconnecting event stream");
			};
		}
		const start = () => {
			installStyles();
			mount();
			new MutationObserver(injectSettingsNavigation).observe(document.body, {
				childList: true,
				subtree: true
			});
			injectSettingsNavigation();
			connect();
		};
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
		else start();
	})();
	//#endregion
})();
