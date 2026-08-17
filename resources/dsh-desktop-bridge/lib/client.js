window.__ModuleLoader__.load({
	id: "dsh-desktop-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const Primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const SETTINGS_PATH = "/api/dsh-desktop/notifications/settings";
		const SHOW_PATH = "/api/dsh-desktop/notifications/show";
		const DEFAULT_SETTINGS = Object.freeze({
			turnCompletion: "unfocused",
			permissionRequests: true,
			questions: true
		});

		function projectSessions(snapshot) {
			const projected = new Map();
			if (snapshot === null || typeof snapshot !== "object") return projected;
			const byId = snapshot.byId;
			if (byId === null || typeof byId !== "object") return projected;
			for (const [id, value] of Object.entries(byId)) {
				if (value === null || typeof value !== "object") continue;
				projected.set(id, {
					id,
					displayTitle: typeof value.displayTitle === "string" ? value.displayTitle : id,
					running: value.running === true,
					pendingInteraction: value.pendingInteraction,
					updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0
				});
			}
			return projected;
		}

		function diffSessionNotifications(previous, next) {
			const notifications = [];
			for (const [id, current] of next) {
				const prior = previous.get(id);
				const interactionChanged = current.pendingInteraction !== undefined
					&& current.pendingInteraction !== prior?.pendingInteraction;
				let kind;
				if (interactionChanged && current.pendingInteraction === "approval") kind = "approval";
				else if (interactionChanged && (current.pendingInteraction === "question" || current.pendingInteraction === "plan-review")) kind = "question";
				else if (prior?.running && !current.running && current.pendingInteraction === undefined) kind = "turn-complete";
				if (kind !== undefined) notifications.push({
					kind,
					sessionId: id,
					sessionTitle: current.displayTitle,
					key: `${kind}:${id}:${current.updatedAt}`
				});
			}
			return notifications;
		}

		async function postNotification(notification) {
			try {
				await fetch(SHOW_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(notification)
				});
			} catch (error) {
				console.warn("[desktop-notifications] failed to show notification", error);
			}
		}

		function normalizeSettings(value) {
			const candidate = value !== null && typeof value === "object" ? value : {};
			return {
				turnCompletion: candidate.turnCompletion === "never" || candidate.turnCompletion === "unfocused" || candidate.turnCompletion === "always"
					? candidate.turnCompletion
					: DEFAULT_SETTINGS.turnCompletion,
				permissionRequests: typeof candidate.permissionRequests === "boolean"
					? candidate.permissionRequests
					: DEFAULT_SETTINGS.permissionRequests,
				questions: typeof candidate.questions === "boolean"
					? candidate.questions
					: DEFAULT_SETTINGS.questions
			};
		}

		function NotificationSettingsSection() {
			const [settings, setSettings] = React.useState(DEFAULT_SETTINGS);
			const [loading, setLoading] = React.useState(true);
			const [saving, setSaving] = React.useState(false);
			const [error, setError] = React.useState("");

			React.useEffect(() => {
				let active = true;
				void fetch(SETTINGS_PATH, { cache: "no-store" })
					.then(async (response) => {
						const payload = await response.json();
						if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
						if (active) setSettings(normalizeSettings(payload.settings));
					})
					.catch((cause) => {
						if (active) setError(cause instanceof Error ? cause.message : String(cause));
					})
					.finally(() => {
						if (active) setLoading(false);
					});
				return () => { active = false; };
			}, []);

			const update = React.useCallback(async (patch) => {
				const next = { ...settings, ...patch };
				setSettings(next);
				setSaving(true);
				setError("");
				try {
					const response = await fetch(SETTINGS_PATH, {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(next)
					});
					const payload = await response.json();
					if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
					setSettings(normalizeSettings(payload.settings));
				} catch (cause) {
					setSettings(settings);
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setSaving(false);
				}
			}, [settings]);

			const disabled = loading || saving;
			return React.createElement("section", { style: styles.section },
				React.createElement("h2", { style: styles.heading }, "通知"),
				React.createElement("div", { style: styles.card },
					React.createElement(SettingRow, {
						title: "轮次完成通知",
						description: "设置回复完成时提醒你的时机"
					}, React.createElement(CompletionMenu, {
						value: settings.turnCompletion,
						disabled,
						onChange: (value) => void update({ turnCompletion: value })
					})),
					React.createElement(SettingRow, {
						title: "启用权限通知",
						description: "在需要通知和权限时显示提醒"
					}, React.createElement(Toggle, {
						checked: settings.permissionRequests,
						disabled,
						label: "启用权限通知",
						onChange: (checked) => void update({ permissionRequests: checked })
					})),
					React.createElement(SettingRow, {
						title: "启用问题通知",
						description: "需要输入才能继续时显示提醒",
						last: true
					}, React.createElement(Toggle, {
						checked: settings.questions,
						disabled,
						label: "启用问题通知",
						onChange: (checked) => void update({ questions: checked })
					}))
				),
				error ? React.createElement("p", { role: "alert", style: styles.error }, `通知功能操作失败：${error}`) : null
			);
		}

		function CompletionMenu({ value, disabled, onChange }) {
			const [open, setOpen] = React.useState(false);
			const labels = {
				never: "从不",
				unfocused: "仅当应用失焦时",
				always: "始终"
			};
			const anchor = React.createElement("button", {
				type: "button",
				"aria-label": "轮次完成通知",
				"aria-haspopup": "menu",
				"aria-expanded": open,
				disabled,
				onClick: () => setOpen((current) => !current),
				style: { ...styles.menuTrigger, opacity: disabled ? 0.6 : 1 }
			},
				React.createElement("span", null, labels[value]),
				React.createElement(Primitives.IconChevronDownOutline14, { size: 14 })
			);
			return React.createElement(Primitives.Menu, {
				open,
				anchor,
				items: [
					{ id: "never", label: labels.never },
					{ id: "unfocused", label: labels.unfocused },
					{ id: "always", label: labels.always }
				],
				selectedId: value,
				onSelect: (id) => {
					setOpen(false);
					onChange(id);
				},
				onClose: () => setOpen(false),
				align: "end",
				portal: true
			});
		}

		function SettingRow({ title, description, last = false, children }) {
			return React.createElement("div", { style: { ...styles.row, ...(last ? styles.lastRow : {}) } },
				React.createElement("div", { style: styles.copy },
					React.createElement("div", { style: styles.title }, title),
					React.createElement("div", { style: styles.description }, description)
				),
				React.createElement("div", { style: styles.control }, children)
			);
		}

		function Toggle({ checked, disabled, label, onChange }) {
			return React.createElement("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				"aria-label": label,
				disabled,
				onClick: () => onChange(!checked),
				style: {
					...styles.toggle,
					background: checked ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-bg-module-platform)",
					opacity: disabled ? 0.6 : 1
				}
			}, React.createElement("span", {
				style: {
					...styles.knob,
					transform: checked ? "translateX(12px)" : "translateX(0)"
				}
			}));
		}

		const styles = {
			section: { width: "100%", color: "var(--dsw-alias-label-primary)" },
			heading: { margin: "0 0 22px", fontSize: 18, fontWeight: 650 },
			card: { width: "100%" },
			row: { display: "flex", alignItems: "center", gap: 8, padding: "16px 0", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
			lastRow: {},
			copy: { flex: 1, minWidth: 0, paddingRight: 48 },
			title: { color: "var(--dsw-alias-label-primary)", fontSize: 14, fontWeight: 400, lineHeight: "22px" },
			description: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, fontWeight: 400, lineHeight: "18px" },
			control: { flex: "0 0 auto" },
			menuTrigger: { minWidth: 142, height: 36, padding: "0 14px", borderRadius: 18, border: 0, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-primary)", font: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
			toggle: { width: 32, height: 20, padding: 2, border: 0, borderRadius: 999, cursor: "pointer", transition: "background 120ms ease" },
			knob: { display: "block", width: 16, height: 16, borderRadius: "50%", background: "white", boxShadow: "0 1px 2px rgba(0,0,0,.3)", transition: "transform 120ms ease" },
			error: { margin: "12px 0 0", color: "#ef6b73", fontSize: 12 }
		};

		exports.name = "desktop-notifications";
		exports.inject = ["slots", "sessions"];
		exports.projectSessions = projectSessions;
		exports.diffSessionNotifications = diffSessionNotifications;
		exports.apply = function apply(ctx) {
			let previous = projectSessions(ctx.sessions.list.getSnapshot());
			const onSessionsChanged = () => {
				const next = projectSessions(ctx.sessions.list.getSnapshot());
				const notifications = diffSessionNotifications(previous, next);
				previous = next;
				for (const notification of notifications) void postNotification(notification);
			};
			const unsubscribe = ctx.sessions.list.subscribe(onSessionsChanged);
			ctx.effect(() => unsubscribe, "desktop-notifications: session transitions");

			const onDesktopMessage = (event) => {
				const value = event.data;
				if (event.source !== window || value === null || typeof value !== "object") return;
				if (value.source !== "deepseek-harness-desktop" || value.type !== "notification-click") return;
				if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return;
				try { ctx.sessions.open(value.sessionId); } catch {}
			};
			window.addEventListener("message", onDesktopMessage);
			ctx.effect(() => () => window.removeEventListener("message", onDesktopMessage), "desktop-notifications: notification click");

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "desktop-notifications",
				order: 20,
				label: "通知"
			}, NotificationSettingsSection));
		};
		return module.exports;
	}
});
