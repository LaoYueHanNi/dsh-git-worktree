window.__ModuleLoader__.load({
	id: "dsh-git-worktree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/normalize.ts
		/**
		* Local branch name for a display name: strip the leading `<remote>/` segment
		* when one is present (`origin/feat/x` → `feat/x`). A local branch whose own
		* name contains `/` (like `feat/x`) passes through unchanged — callers that
		* need certainty compare against the authoritative branch list instead.
		* @param branch - branch display name.
		* @returns the candidate local branch name.
		*/
		function localBranchName(branch) {
			const at = branch.indexOf("/");
			return at <= 0 ? branch : branch.slice(at + 1);
		}
		/**
		* Validate a user-configured worktree storage root: an absolute path on any
		* platform (POSIX `/…`, Windows drive `C:\…`/`C:/…`, or UNC `\\…`).
		* @param value - raw settings string.
		* @returns true when the value names an absolute path.
		*/
		function isAbsoluteConfigPath(value) {
			if (value === "") return false;
			if (value.startsWith("/") || value.startsWith("\\")) return true;
			return /^[a-zA-Z]:[\\/]/.test(value);
		}
		//#endregion
		//#region src/wire.ts
		/**
		* Shared wire contract between the host half (HTTP routes under
		* `/plugin/git-worktree`) and the browser half (chip + settings section).
		* Zero runtime dependencies: constants and types only, imported by both
		* builds.
		*/
		/** Absolute pathname prefix every route of this plugin lives under. */
		const ROUTE_PREFIX = "/plugin/git-worktree";
		/** GET ROUTE_PREFIX/status?path=<absolute dir> */
		const ROUTE_STATUS = `${ROUTE_PREFIX}/status`;
		/** GET/PUT ROUTE_PREFIX/settings — the plugin's own persisted configuration. */
		const ROUTE_SETTINGS = `${ROUTE_PREFIX}/settings`;
		/** POST ROUTE_PREFIX/worktree — create-or-reuse a worktree for a branch. */
		const ROUTE_WORKTREE = `${ROUTE_PREFIX}/worktree`;
		/** POST ROUTE_PREFIX/switch — in-place branch switch of the main checkout. */
		const ROUTE_SWITCH = `${ROUTE_PREFIX}/switch`;
		//#endregion
		//#region src/client/api.ts
		/** POST one JSON body and parse the uniform envelope. */
		async function post(url, body) {
			return send("POST", url, body);
		}
		/** Send one JSON body with any method and parse the uniform envelope. */
		async function send(method, url, body) {
			try {
				const response = await fetch(url, {
					method,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				const payload = await response.json();
				if (!response.ok) return {
					ok: false,
					error: payload.error ?? `HTTP ${String(response.status)}`
				};
				return {
					...payload,
					ok: true
				};
			} catch (cause) {
				return {
					ok: false,
					error: cause instanceof Error ? cause.message : String(cause)
				};
			}
		}
		/**
		* Repository status for one directory.
		* @param path - absolute workspace directory.
		*/
		async function fetchStatus(path) {
			try {
				const response = await fetch(`${ROUTE_STATUS}?path=${encodeURIComponent(path)}`, { cache: "no-store" });
				if (!response.ok) return {
					ok: false,
					error: `HTTP ${String(response.status)}`
				};
				return {
					...await response.json(),
					ok: true
				};
			} catch (cause) {
				return {
					ok: false,
					error: cause instanceof Error ? cause.message : String(cause)
				};
			}
		}
		/**
		* Create or reuse the worktree for a branch.
		* @param repoPath - absolute directory inside the repository.
		* @param branch - branch display name.
		*/
		function requestWorktree(repoPath, branch) {
			return post(ROUTE_WORKTREE, {
				repoPath,
				branch
			});
		}
		/**
		* Read the plugin's persisted settings.
		*/
		async function fetchSettings() {
			try {
				const response = await fetch(ROUTE_SETTINGS, { cache: "no-store" });
				if (!response.ok) return {
					ok: false,
					error: `HTTP ${String(response.status)}`
				};
				return {
					...await response.json(),
					ok: true
				};
			} catch (cause) {
				return {
					ok: false,
					error: cause instanceof Error ? cause.message : String(cause)
				};
			}
		}
		/**
		* Persist new settings.
		* @param value - the complete document to store.
		*/
		function putSettings(value) {
			return send("PUT", ROUTE_SETTINGS, value);
		}
		/**
		* Switch the main checkout in place.
		* @param repoPath - absolute directory inside the main worktree.
		* @param branch - branch display name.
		*/
		function requestSwitch(repoPath, branch) {
			return post(ROUTE_SWITCH, {
				repoPath,
				branch
			});
		}
		//#endregion
		//#region src/client/ConfirmPop.tsx
		/**
		* ConfirmPop: a small anchored confirmation bubble — the same portal-fixed
		* posture as the branch Menu (below the chip, Menu's card chrome: r12,
		* inverted hairline, shadow-lv3, --dsw-specific-menu), carrying one ask line
		* and a compact Cancel/Confirm pair. Replaces the centered modal so the
		* confirm step reads as the menu's second page rather than an app dialog.
		*/
		/**
		* Render the anchored confirmation bubble.
		* @param props - anchor, copy, state, and the class sheet.
		* @returns null while closed; otherwise the portaled bubble.
		*/
		function ConfirmPop({ open, anchorRef, ask, confirmLabel, cancelLabel, busy, onConfirm, onCancel, classes }) {
			const cardRef = (0, react.useRef)(null);
			const [pos, setPos] = (0, react.useState)(null);
			(0, react.useLayoutEffect)(() => {
				if (!open) {
					setPos(null);
					return;
				}
				const place = () => {
					const anchor = anchorRef.current;
					if (anchor === null) return;
					const rect = anchor.getBoundingClientRect();
					setPos({
						left: rect.left,
						top: rect.bottom + 6
					});
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [open, anchorRef]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (cardRef.current?.contains(event.target) === true) return;
					if (anchorRef.current?.contains(event.target) === true) return;
					onCancel();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") onCancel();
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [
				open,
				onCancel,
				anchorRef
			]);
			if (!open || pos === null) return null;
			const card = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: cardRef,
				className: classes.card,
				style: {
					left: pos.left,
					top: pos.top
				},
				role: "dialog",
				"aria-label": ask,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: classes.ask,
					children: ask
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: classes.actions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: busy,
						onClick: onCancel,
						children: cancelLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: busy,
						onClick: onConfirm,
						children: busy ? confirmLabel : confirmLabel
					})]
				})]
			});
			return (0, react_dom.createPortal)(card, document.body);
		}
		//#endregion
		//#region \0git-worktree-css:D:\Code\dsh-worktree\src\client\BranchChip.module.css?inline
		const css$1 = "/* Branch chip row inside the composer tool row (conversation.input_2006230319.left_2006230319,\n * right of the mode chips). Modeled as a single rounded-rectangle\n * segmented control: the branch picker and the worktree toggle share one\n * container with a thin divider between them, so they read as one\n * affordance instead of two loose buttons.\n *\n * Geometry mirrors the composer trigger chips in the DSH base (see\n * PermissionSelect / ModelSelect): 28px height, 13/20 medium-secondary\n * label, transparent fill, no outline 鈥?the dock stays at the same\n * visual weight as the surrounding chips (dsh-worktree select, standard\n * mode select, Workspace Write, MiniMax-M3 High). The corners stop short\n * of the base's full pill (24px) so the silhouette stays a chip rather\n * than a capsule, per the design brief. */\n\n/* Shared trigger geometry 鈥?copied 1:1 from the base composer triggers\n * (PermissionSelect .trigger_2006230319 / ModelSelect .trigger_2006230319). Centralizing here\n * keeps the two segments visually fused so the divider reads as part of\n * one component, not two loose buttons. */\n.dock_2006230319 {\n  display: inline-flex;\n  align-items: stretch;\n  height: 28px;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  min-height: 28px;\n  overflow: hidden;\n}\n\n/* Vertical separator between the two segments. Uses the secondary label\n * color so it stays in the same tonal family as the surrounding trigger\n * outlines and chevrons. */\n.divider_2006230319 {\n  width: 1px;\n  margin: 6px 0;\n  background: color-mix(in srgb, currentColor 22%, transparent);\n  flex-shrink: 0;\n}\n\n.chip_2006230319 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 8px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.chip_2006230319:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The leftmost segment rounds only its left corners so it tucks into the dock. */\n.chip_2006230319:first-child {\n  border-top-left-radius: 6px;\n  border-bottom-left-radius: 6px;\n}\n\n/* Started sessions drop the worktree segment: the lone chip rounds all\n * corners and reads as a plain button, not a broken-off half control. */\n.chip_2006230319:only-child {\n  border-radius: 6px;\n}\n\n.branch_2006230319 {\n  max-width: 16em;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.check_2006230319,\n.checkOn_2006230319 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 4px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.check_2006230319:hover,\n.checkOn_2006230319:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The rightmost segment rounds only its right corners. */\n.check_2006230319:last-child,\n.checkOn_2006230319:last-child {\n  border-top-right-radius: 6px;\n  border-bottom-right-radius: 6px;\n}\n\n.box_2006230319 {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 14px;\n  height: 14px;\n  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);\n  border-radius: 4px;\n}\n\n/* Selected worktree: only the checkbox itself turns bluish and fills 鈥?the\n * surrounding button stays transparent so the label keeps the same\n * secondary tone. Mirrors the Claude Code toggle treatment. The inner\n * check rides the bluish fill with an inverted foreground token so the\n * glyph stays legible. */\n.checkOn_2006230319 .box_2006230319 {\n  border-color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  background: var(--dsw-alias-label-primary-bluish, #4186f0);\n  color: var(--dsw-alias-label-primary-foreground, #ffffff);\n}\n\n.checkLabel_2006230319 {\n  white-space: nowrap;\n}\n\n/* Confirmation bubble: the branch Menu's own card chrome (r12, inverted\n * hairline, shadow-lv3, --dsw-specific-menu) so the confirm step reads as\n * the menu's second page; one ask line and a compact button pair. */\n.popCard_2006230319 {\n  position: fixed;\n  z-index: 1000;\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n  min-width: 200px;\n  max-width: 340px;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.popAsk_2006230319 {\n  margin: 0;\n  padding: 6px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: inherit;\n}\n\n.popActions_2006230319 {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type. */\n.popActions_2006230319 button {\n  flex: 1 1 0;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  cursor: pointer;\n}\n\n.popActions_2006230319 button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.popActions_2006230319 button:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.popActions_2006230319 button:last-child {\n  color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  font-weight: 500;\n}\n";
		const tagId$1 = "dsh-git-worktree/BranchChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-git-worktree/BranchChip.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-git-worktree";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var BranchChip_module_default = {
			"input": "input_2006230319",
			"left": "left_2006230319",
			"trigger": "trigger_2006230319",
			"dock": "dock_2006230319",
			"divider": "divider_2006230319",
			"chip": "chip_2006230319",
			"branch": "branch_2006230319",
			"check": "check_2006230319",
			"checkOn": "checkOn_2006230319",
			"box": "box_2006230319",
			"checkLabel": "checkLabel_2006230319",
			"popCard": "popCard_2006230319",
			"popAsk": "popAsk_2006230319",
			"popActions": "popActions_2006230319"
		};
		//#endregion
		//#region src/client/BranchChip.tsx
		/**
		* BranchChipDock: the composer tool-row entry (conversation.input.left, right
		* of the mode chips) for sessions inside a git repository. Blank sessions
		* get the full segmented control — branch picker plus the worktree
		* isolation toggle — because that is the moment to choose the environment
		* for the conversation. Once the session starts, the worktree toggle is
		* withdrawn: a started session may still switch branches in place (a
		* switch inside a linked worktree checks out within that worktree —
		* probeRepo roots at the session directory's toplevel, never the main
		* checkout), but its directory is fixed. Non-git directories and load
		* failures render nothing. The confirm dialogs and the error toast live
		* here too.
		*/
		/**
		* Heavier check glyph for the worktree toggle. The base's IconCheckOutline16
		* is a fill path (fixed visual weight); we need a visibly bolder stroke to
		* read inside the 14×14 bluish fill — local to this module so the heavier
		* weight doesn't leak into the rest of the composer chrome.
		*/
		function WorktreeCheck({ size = 12 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.2 8.4 L6.6 11.8 L12.8 4.4",
					stroke: "currentColor",
					strokeWidth: "3.2",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/**
		* Read the repository status for a directory; refetch on demand.
		* @param cwd - absolute session directory.
		* @returns the state holder and a refetch verb.
		*/
		function useRepoStatus(cwd) {
			const [state, setState] = (0, react.useState)({ facts: null });
			const load = (0, react.useCallback)(async () => {
				if (cwd === void 0) {
					setState({ facts: null });
					return;
				}
				const result = await fetchStatus(cwd);
				setState({ facts: result.ok && result.repo ? result : null });
			}, [cwd]);
			(0, react.useEffect)(() => {
				let live = true;
				setState({ facts: null });
				if (cwd !== void 0) fetchStatus(cwd).then((result) => {
					if (live) setState({ facts: result.ok && result.repo ? result : null });
				});
				return () => {
					live = false;
				};
			}, [cwd]);
			return [state, load];
		}
		/** Longest branch name shown on the chip before ellipsizing (chars, … included). */
		const BRANCH_DISPLAY_MAX = 25;
		/**
		* Clamp a branch name for chip display: names up to 25 chars pass through;
		* longer ones show the first 24 chars plus an ellipsis.
		* @param branch - full branch name.
		*/
		function displayBranch(branch) {
			return branch.length <= BRANCH_DISPLAY_MAX ? branch : `${branch.slice(0, 24)}…`;
		}
		/**
		* Assemble the branch menu: local branches only (remote branches are not
		* offered). A branch already checked out by a live worktree is disabled
		* while the worktree toggle is off (git refuses such a switch); with the
		* toggle on it is the reuse path, so it stays selectable. The selected row's
		* trailing check is the Menu's own selectedId affordance — no leading icon.
		*/
		function buildMenuEntries(branches, worktrees, currentBranch, worktreeMode, t) {
			const occupied = new Set(worktrees.flatMap((w) => w.branch === void 0 ? [] : [w.branch]));
			const item = (branch) => ({
				id: branch.name,
				label: branch.name,
				disabled: branch.name !== currentBranch && !worktreeMode && occupied.has(localBranchName(branch.name))
			});
			const local = branches.filter((b) => b.kind === "local");
			const entries = [{
				type: "label",
				id: "local",
				text: t("menuLocalBranches")
			}];
			entries.push(...local.map(item));
			return entries;
		}
		/** The tool-row entry registered into conversation.input.left. */
		function BranchChipDock({ session, sessionId, useSessions, adoptWorktree, t }) {
			const cwd = useSessions((state) => state.byId[sessionId])?.cwd;
			const [repo, refresh] = useRepoStatus(cwd);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [worktreeMode, setWorktreeMode] = (0, react.useState)(false);
			const [confirm, setConfirm] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [toast, setToast] = (0, react.useState)(null);
			const chipRef = (0, react.useRef)(null);
			const busyRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				setWorktreeMode(false);
				setConfirm(null);
				setMenuOpen(false);
			}, [cwd]);
			(0, react.useEffect)(() => {
				if (!session.blank) setWorktreeMode(false);
			}, [session.blank]);
			const showError = (0, react.useCallback)((message) => {
				setToast({
					seq: Date.now(),
					text: t("errorGeneric", { message })
				});
			}, [t]);
			/** Run one guarded confirm action: single-flight, toast on failure, close on success. */
			const runGuarded = (0, react.useCallback)(async (action) => {
				if (busyRef.current) return;
				busyRef.current = true;
				setBusy(true);
				const failure = await action();
				busyRef.current = false;
				setBusy(false);
				if (failure !== void 0) {
					showError(failure);
					return;
				}
				setConfirm(null);
				setMenuOpen(false);
			}, [showError]);
			/** In-place switch flow: POST /switch, then refetch the status. */
			const doSwitch = (0, react.useCallback)((branch) => runGuarded(async () => {
				if (cwd === void 0) return "no session directory";
				const result = await requestSwitch(cwd, branch);
				if (!result.ok) return result.error;
				await refresh();
			}), [
				cwd,
				refresh,
				runGuarded
			]);
			/** Worktree flow: POST /worktree, register the directory, hop sessions. */
			const doWorktree = (0, react.useCallback)((branch) => runGuarded(async () => {
				if (cwd === void 0) return "no session directory";
				const result = await requestWorktree(cwd, branch);
				if (!result.ok) return result.error;
				try {
					await adoptWorktree(result.path);
				} catch (cause) {
					return cause instanceof Error ? cause.message : String(cause);
				}
			}), [
				adoptWorktree,
				cwd,
				runGuarded
			]);
			const facts = repo.facts;
			const entries = (0, react.useMemo)(() => facts === null ? [] : buildMenuEntries(facts.branches, facts.worktrees, facts.currentBranch, worktreeMode, t), [
				facts,
				worktreeMode,
				t
			]);
			if (facts === null) return null;
			const confirmLocalName = confirm === null ? "" : localBranchName(confirm.branch);
			const existingWorktree = confirm === null ? void 0 : facts.worktrees.find((w) => w.branch === confirmLocalName);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: BranchChip_module_default.dock,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: chipRef,
						type: "button",
						className: BranchChip_module_default.chip,
						onClick: () => {
							setMenuOpen((open) => !open);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, { size: 12 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.branch,
							children: displayBranch(facts.currentBranch)
						})]
					}), session.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: BranchChip_module_default.divider,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: worktreeMode ? BranchChip_module_default.checkOn : BranchChip_module_default.check,
						onClick: () => {
							setWorktreeMode((on) => !on);
						},
						title: t("worktreeToggle"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.box,
							children: worktreeMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorktreeCheck, { size: 10 }) : null
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.checkLabel,
							children: t("chipWorktree")
						})]
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open: menuOpen,
					anchor: null,
					portal: true,
					getAnchorRect: () => chipRef.current?.getBoundingClientRect() ?? null,
					items: entries,
					selectedId: facts.currentBranch,
					onClose: () => {
						setMenuOpen(false);
					},
					onSelect: (id) => {
						setMenuOpen(false);
						if (id === facts.currentBranch) return;
						setConfirm({
							kind: worktreeMode ? "worktree" : "switch",
							branch: id
						});
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmPop, {
					open: confirm !== null,
					anchorRef: chipRef,
					ask: confirm?.kind === "worktree" ? t(existingWorktree !== void 0 ? "worktreeAskReuse" : "worktreeAskNew", { branch: confirmLocalName }) : t("switchAsk", { branch: confirm?.branch ?? "" }),
					confirmLabel: busy ? confirm?.kind === "worktree" ? t("worktreeBusy") : t("switchBusy") : t("actionConfirm"),
					cancelLabel: t("actionCancel"),
					busy,
					onConfirm: () => {
						if (confirm === null) return;
						if (confirm.kind === "worktree") doWorktree(confirm.branch);
						else doSwitch(confirm.branch);
					},
					onCancel: () => {
						if (!busy) setConfirm(null);
					},
					classes: {
						card: BranchChip_module_default.popCard,
						ask: BranchChip_module_default.popAsk,
						actions: BranchChip_module_default.popActions
					}
				}),
				toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
					text: toast.text,
					onDone: () => {
						setToast(null);
					}
				}, toast.seq)
			] });
		}
		//#endregion
		//#region \0git-worktree-css:D:\Code\dsh-worktree\src\client\SettingsSection.module.css?inline
		const css = "/* Settings section body: one labeled path input with its save action. */\n\n.body_1072284477 {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  max-width: 32em;\n}\n\n.description_1072284477 {\n  margin: 0;\n  color: color-mix(in srgb, currentColor 70%, transparent);\n  font-size: 13px;\n}\n\n.label_1072284477 {\n  font-size: 13px;\n  font-weight: 500;\n}\n\n.row_1072284477 {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n}\n\n.row_1072284477 > :first-child {\n  flex: 1;\n}\n\n/* Auto-save status note (\"Saving… / Saved\") after the browse button. */\n.status_1072284477 {\n  flex-shrink: 0;\n  color: var(--dsw-alias-label-primary-bluish, currentColor);\n  font-size: 12px;\n  white-space: nowrap;\n}\n\n.help_1072284477 {\n  margin: 0;\n  color: color-mix(in srgb, currentColor 55%, transparent);\n  font-size: 12px;\n}\n\n.error_1072284477 {\n  margin: 0;\n  color: var(--dsw-color-danger, #d5484f);\n  font-size: 12px;\n}\n";
		const tagId = "dsh-git-worktree/SettingsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-git-worktree/SettingsSection.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-git-worktree";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SettingsSection_module_default = {
			"body": "body_1072284477",
			"description": "description_1072284477",
			"label": "label_1072284477",
			"row": "row_1072284477",
			"status": "status_1072284477",
			"help": "help_1072284477",
			"error": "error_1072284477"
		};
		//#endregion
		//#region src/client/SettingsSection.tsx
		/**
		* WorktreeSettingsSection: the plugin's settings page — the storage-root
		* field bound to the plugin's own settings route. Every commit path is
		* automatic: picking a folder in the native dialog saves on the spot, and
		* manual edits save on Enter or blur, with a short inline status note —
		* there is no confirm button. Empty string selects the default
		* ~/.dsh/gitworktree.
		*/
		/**
		* The settings section body.
		* @param props - the native picker verb and the locale seat.
		*/
		function WorktreeSettingsSection({ pickDirectory, t }) {
			const [stored, setStored] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [picking, setPicking] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [savedFlash, setSavedFlash] = (0, react.useState)(false);
			const rowRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				let live = true;
				fetchSettings().then((result) => {
					if (!live) return;
					if (result.ok) {
						setStored(result.rootDir);
						setDraft(result.rootDir);
					} else setError(result.error);
				});
				return () => {
					live = false;
				};
			}, []);
			/** Persist a root value — shared by every auto-save path. */
			const persist = (0, react.useCallback)(async (value) => {
				if (busy) return;
				const trimmed = value.trim();
				if (trimmed !== "" && !isAbsoluteConfigPath(trimmed)) {
					setError(t("settingsRootDirInvalid"));
					return;
				}
				setBusy(true);
				setError(null);
				const result = await putSettings({ rootDir: trimmed });
				setBusy(false);
				if (!result.ok) {
					setError(result.error);
					return;
				}
				setStored(trimmed);
				setSavedFlash(true);
				setTimeout(() => {
					setSavedFlash(false);
				}, 1500);
			}, [busy, t]);
			/** Manual edits commit on Enter, or on blur that leaves the row. */
			const commitDraft = (0, react.useCallback)(() => {
				if (stored !== null && draft.trim() !== stored) persist(draft);
			}, [
				draft,
				persist,
				stored
			]);
			/**
			* Native picker: a pick fills the draft AND saves it immediately. A
			* dismissal changes nothing.
			*/
			const browse = (0, react.useCallback)(async () => {
				if (picking) return;
				setPicking(true);
				try {
					const picked = await pickDirectory();
					if (picked !== null) {
						setDraft(picked);
						setError(null);
						await persist(picked);
					}
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setPicking(false);
				}
			}, [
				persist,
				pickDirectory,
				picking
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsSection_module_default.body,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsSection_module_default.description,
						children: t("settingsDescription")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: SettingsSection_module_default.label,
						htmlFor: "git-worktree-root-dir",
						children: t("settingsRootDir")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsSection_module_default.row,
						ref: rowRef,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								id: "git-worktree-root-dir",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, { size: 12 }),
								value: draft,
								placeholder: "~/.dsh/gitworktree",
								spellCheck: false,
								disabled: busy || picking,
								onChange: (event) => {
									setDraft(event.target.value);
									setError(null);
								},
								onKeyDown: (event) => {
									if (event.key === "Enter") commitDraft();
								},
								onBlur: (event) => {
									const next = event.relatedTarget;
									if (next instanceof Node && rowRef.current?.contains(next)) return;
									commitDraft();
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: picking,
								onClick: () => {
									browse();
								},
								title: t("settingsBrowse"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, { size: 14 })
							}),
							(busy || savedFlash) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: SettingsSection_module_default.status,
								children: busy ? t("settingsSaving") : t("settingsSaved")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsSection_module_default.help,
						children: t("settingsRootDirHelp")
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsSection_module_default.error,
						role: "alert",
						children: error
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** English dictionary — complete by construction. */
		const en = {
			chipWorktree: "Worktree",
			worktreeToggle: "Create an isolated worktree",
			menuLocalBranches: "Local branches",
			switchAsk: "Switch to {branch}?",
			switchBusy: "Switching…",
			worktreeAskNew: "Create a worktree from {branch}?",
			worktreeAskReuse: "Switch to the {branch} worktree?",
			worktreeBusy: "Creating…",
			actionCancel: "Cancel",
			actionConfirm: "Confirm",
			errorGeneric: "Git worktree: {message}",
			settingsNav: "Git Worktree",
			settingsTitle: "Git worktree",
			settingsDescription: "Where isolated worktree folders for new sessions are stored.",
			settingsRootDir: "Worktree storage folder",
			settingsBrowse: "Browse…",
			settingsRootDirHelp: "Absolute path. Empty uses the default ~/.dsh/gitworktree.",
			settingsRootDirInvalid: "Enter an absolute path, or leave it empty for the default.",
			settingsSaving: "Saving…",
			settingsSaved: "Saved"
		};
		/** 中文词典。 */
		const zh = {
			chipWorktree: "工作树",
			worktreeToggle: "创建隔离工作树",
			menuLocalBranches: "本地分支",
			switchAsk: "是否切到 {branch}？",
			switchBusy: "切换中…",
			worktreeAskNew: "是否从 {branch} 新建工作树？",
			worktreeAskReuse: "是否切到 {branch} 工作树？",
			worktreeBusy: "创建中…",
			actionCancel: "取消",
			actionConfirm: "确认",
			errorGeneric: "Git 工作树：{message}",
			settingsNav: "Git 工作树",
			settingsTitle: "Git 工作树",
			settingsDescription: "新会话的隔离工作树文件夹存放位置。",
			settingsRootDir: "工作树存放目录",
			settingsBrowse: "浏览…",
			settingsRootDirHelp: "绝对路径。留空使用默认 ~/.dsh/gitworktree。",
			settingsRootDirInvalid: "请输入绝对路径，或留空使用默认位置。",
			settingsSaving: "保存中…",
			settingsSaved: "已保存"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "git-worktree";
		/** Required services: slot ledger, session/workspace runtime, and copy. */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"locale"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "git-worktree: dictionaries");
			const chipInjected = () => ({ adoptWorktree: async (path) => {
				const workspace = await ctx.workspaces.create({ path });
				ctx.workspaces.startSession(workspace.workspaceId);
			} });
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "git-worktree",
				order: 5,
				locale: NS,
				inject: chipInjected
			}, BranchChipDock));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "git-worktree",
				order: 40,
				label: () => ctx.locale.bind(NS)("settingsNav"),
				locale: NS,
				inject: () => ({ pickDirectory: () => ctx.workspaces.pickDirectory() })
			}, WorktreeSettingsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map