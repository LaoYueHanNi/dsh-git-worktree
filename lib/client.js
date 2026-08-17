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
		//#region \0git-worktree-css:E:\Documents\MyCode\oyw-dsh-plugin\dsh-git-worktree\src\client\BranchChip.module.css?inline
		const css$1 = "/* Branch chip row inside the composer tool row (conversation.input_1192525008.left_1192525008,\n * right of the mode chips). Modeled as a single rounded-rectangle\n * segmented control: the branch picker and the worktree toggle share one\n * container with a thin divider between them, so they read as one\n * affordance instead of two loose buttons.\n *\n * Geometry mirrors the composer trigger chips in the DSH base (see\n * PermissionSelect / ModelSelect): 28px height, 13/20 medium-secondary\n * label, transparent fill, no outline 鈥?the dock stays at the same\n * visual weight as the surrounding chips (dsh-worktree select, standard\n * mode select, Workspace Write, MiniMax-M3 High). The corners stop short\n * of the base's full pill (24px) so the silhouette stays a chip rather\n * than a capsule, per the design brief. */\n\n/* Shared trigger geometry 鈥?copied 1:1 from the base composer triggers\n * (PermissionSelect .trigger_1192525008 / ModelSelect .trigger_1192525008). Centralizing here\n * keeps the two segments visually fused so the divider reads as part of\n * one component, not two loose buttons. */\n.dock_1192525008 {\n  display: inline-flex;\n  align-items: stretch;\n  height: 28px;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  min-height: 28px;\n  overflow: hidden;\n}\n\n/* Vertical separator between the two segments. Uses the secondary label\n * color so it stays in the same tonal family as the surrounding trigger\n * outlines and chevrons. */\n.divider_1192525008 {\n  width: 1px;\n  margin: 6px 0;\n  background: color-mix(in srgb, currentColor 22%, transparent);\n  flex-shrink: 0;\n}\n\n.chip_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 8px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.chip_1192525008:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The leftmost segment rounds only its left corners so it tucks into the dock. */\n.chip_1192525008:first-child {\n  border-top-left-radius: 6px;\n  border-bottom-left-radius: 6px;\n}\n\n/* Started sessions drop the worktree segment: the lone chip rounds all\n * corners and reads as a plain button, not a broken-off half control. */\n.chip_1192525008:only-child {\n  border-radius: 6px;\n}\n\n.branch_1192525008 {\n  max-width: 16em;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.check_1192525008,\n.checkOn_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 4px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.check_1192525008:hover,\n.checkOn_1192525008:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The rightmost segment rounds only its right corners. */\n.check_1192525008:last-child,\n.checkOn_1192525008:last-child {\n  border-top-right-radius: 6px;\n  border-bottom-right-radius: 6px;\n}\n\n.box_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 14px;\n  height: 14px;\n  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);\n  border-radius: 4px;\n}\n\n/* Selected worktree: only the checkbox itself turns bluish and fills 鈥?the\n * surrounding button stays transparent so the label keeps the same\n * secondary tone. Mirrors the Claude Code toggle treatment. The inner\n * check rides the bluish fill with an inverted foreground token so the\n * glyph stays legible. */\n.checkOn_1192525008 .box_1192525008 {\n  border-color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  background: var(--dsw-alias-label-primary-bluish, #4186f0);\n  color: var(--dsw-alias-label-primary-foreground, #ffffff);\n}\n\n.checkLabel_1192525008 {\n  white-space: nowrap;\n}\n\n/* Confirm flyout: the second-level panel opening right of the branch\n * card (the base Menu's submenu posture: r12, inverted hairline,\n * shadow-lv3, --dsw-specific-menu). Width is content-driven — it follows\n * the branch name in the ask line — floored at 124px (a bit above the\n * Cancel/Confirm pair's own minimum, so short names stay tight instead of\n * riding the old 200px floor) and capped at 400px; BranchMenu also clamps\n * it inline to the room right of the card. Beyond the cap the ask wraps.\n * border-box so every width arm includes the card chrome. */\n.popCard_1192525008 {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1000;\n  width: max-content;\n  min-width: 124px;\n  max-width: min(400px, 80vw);\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.popAsk_1192525008 {\n  margin: 0;\n  padding: 6px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: inherit;\n  /* Branch names are long unbroken tokens — plain wrapping would let them\n   * overflow the capped card instead of breaking. */\n  overflow-wrap: anywhere;\n}\n\n.popActions_1192525008 {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type. */\n.popActions_1192525008 button {\n  flex: 1 1 0;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  cursor: pointer;\n}\n\n.popActions_1192525008 button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.popActions_1192525008 button:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.popActions_1192525008 button:last-child {\n  color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  font-weight: 500;\n}\n\n/* ── Branch picker popup (BranchMenu) ──────────────────────────────\n * Upward-opening card pinned above the chip, in the Menu's card chrome\n * (r12, inverted hairline, shadow-lv3, --dsw-specific-menu — same family\n * as .popCard_1192525008). Three owner requirements shape the geometry:\n *\n *   1. height cap: min(420px, 60vh) on the card, only the rows area\n *      scrolls (.menuRows_1192525008) — heading and search stay pinned;\n *   2. the search field sits pinned at the card's bottom edge, directly\n *      above the chip, with the scrolling rows above it;\n *   3. the card is CSS-`bottom`-pinned ~6px above the chip's top and so\n *      grows entirely upward — it can never cover the composer or fill\n *      the viewport, whatever the branch count.\n *\n * The inline `left`/`bottom` come from BranchMenu's placement pass; the\n * width is fixed here (design 320px, viewport-capped) so horizontal\n * clamping stays deterministic without measuring the card. */\n\n/* The portal lands directly under document.body_1192525008, outside the shell's\n * box-sizing reset — content-box default would add padding/border on top\n * of the declared width (320 became 330, and the width:100% children\n * padded 16px past the card's right clip, shearing off their rounded\n * corners). Every width-declared box in this popup opts back into\n * border-box: the card, the rows, and the search input. */\n.menuCard_1192525008 {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1000;\n  display: flex;\n  flex-direction: column;\n  width: min(320px, calc(100vw - 24px));\n  max-height: min(420px, 60vh);\n  overflow: hidden;\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n}\n\n/* Non-interactive group heading — the Menu label row's posture. */\n.menuHeading_1192525008 {\n  padding: 6px 8px 4px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  flex-shrink: 0;\n}\n\n/* The only scrollable region: shrinks within the capped card so the\n * heading above and the search below stay visible while rows scroll. */\n.menuRows_1192525008 {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type.\n * Weight 500 mirrors the chip's branch label (the portal escapes the\n * composer's font context, so the match must be explicit — the inherited\n * body weight is 400 and reads visibly lighter than the chip beside it). */\n.menuRow_1192525008 {\n  box-sizing: border-box; /* width:100% + padding must stay inside .menuRows_1192525008 */\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 28px;\n  padding: 4px 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.menuRow_1192525008:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* Occupied-worktree branches: dimmed, not clickable. */\n.menuRow_1192525008:disabled {\n  opacity: 0.45;\n  cursor: default;\n}\n\n.menuRowLabel_1192525008 {\n  flex: 1 1 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Zero-search-hit state: centered secondary line inside the rows area. */\n.menuEmpty_1192525008 {\n  padding: 10px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  text-align: center;\n}\n\n/* Bottom-pinned search field, separated from the rows by a hairline.\n * Borderless so it reads as part of the card, focus shown as the\n * standard hover tint rather than an outline. */\n.menuSearchWrap_1192525008 {\n  flex-shrink: 0;\n  margin-top: 2px;\n  padding-top: 4px;\n  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);\n}\n\n.menuSearch_1192525008 {\n  box-sizing: border-box; /* width:100% + padding must stay inside the wrap */\n  width: 100%;\n  height: 30px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  /* Weight 500 mirrors the chip's branch label (see .menuRow_1192525008) — the portal\n   * escapes the composer's font context and would inherit body's 400. */\n  font-weight: 500;\n  line-height: 20px;\n}\n\n.menuSearch_1192525008::placeholder {\n  color: var(--dsw-alias-label-secondary, #81858c);\n}\n\n.menuSearch_1192525008:focus {\n  outline: none;\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n";
		const tagId$1 = "dsh-git-worktree/BranchChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-git-worktree/BranchChip.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-git-worktree";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var BranchChip_module_default = {
			"input": "input_1192525008",
			"left": "left_1192525008",
			"trigger": "trigger_1192525008",
			"dock": "dock_1192525008",
			"divider": "divider_1192525008",
			"chip": "chip_1192525008",
			"branch": "branch_1192525008",
			"check": "check_1192525008",
			"checkOn": "checkOn_1192525008",
			"box": "box_1192525008",
			"checkLabel": "checkLabel_1192525008",
			"popCard": "popCard_1192525008",
			"popAsk": "popAsk_1192525008",
			"popActions": "popActions_1192525008",
			"menuRows": "menuRows_1192525008",
			"body": "body_1192525008",
			"menuCard": "menuCard_1192525008",
			"menuHeading": "menuHeading_1192525008",
			"menuRow": "menuRow_1192525008",
			"menuRowLabel": "menuRowLabel_1192525008",
			"menuEmpty": "menuEmpty_1192525008",
			"menuSearchWrap": "menuSearchWrap_1192525008",
			"menuSearch": "menuSearch_1192525008"
		};
		//#endregion
		//#region src/client/BranchMenu.tsx
		/**
		* BranchMenu: the branch picker popup anchored to the composer branch chip.
		* The base Menu primitive exposes neither a height cap nor a search field,
		* so with many branches its portal list fills the viewport — this popup
		* replaces it with an owner-styled card: Menu's card chrome (r12, inverted
		* hairline, shadow-lv3, --dsw-specific-menu, see .menuCard) on a
		* portal-fixed posture, with three owner requirements baked in:
		*
		*   1. the card is capped at min(420px, 60vh) and only the branch rows
		*      scroll (heading and search stay pinned);
		*   2. a search field is pinned at the card's bottom edge — the row list
		*      scrolls above it — filtering rows by case-insensitive substring;
		*   3. the card opens entirely above the chip: the CSS `bottom` pins its
		*      bottom edge ~6px above the chip's top, so it grows upward and can
		*      never cover the composer, whatever the branch count.
		*
		* The confirm step is a second-level flyout opening to the RIGHT of the
		* branch card (the base Menu's submenu posture): the chip sits in the
		* bottom composer, so the old below-the-chip bubble landed off-viewport.
		* The flyout is a separate portal (not clipped by the card's
		* overflow:hidden), horizontally anchored to the card's right edge — it
		* can never overlap the branch list — and vertically centered on the
		* picked row. Its width is content-driven (it follows the branch name in
		* the ask line), capped in CSS, wrapping beyond the cap. Picking a
		* different row while the flyout is open re-anchors it beside that row.
		*
		* Close semantics: outside pointerdown (card, flyout, and chip excluded)
		* cancels the confirm and closes the menu; Escape cancels tier by tier —
		* first the confirm, then the menu; Enter in the search field commits the
		* first enabled visible row.
		*/
		/** Viewport edge clearance, mirroring the base Menu portal margin. */
		const MARGIN = 12;
		/** Gap kept between the chip's top edge and the card's bottom edge. */
		const GAP = 6;
		/** Design card width — the CSS width's px arm; used for horizontal clamping. */
		const CARD_WIDTH = 320;
		/** Design flyout width cap — matches .popCard's max-width arm. */
		const FLY_MAX_WIDTH = 400;
		/** Unplaced flyout: hidden but laid out at a fixed origin so offsetWidth/
		* offsetHeight are real for the measure-then-place pass (base Menu trick). */
		const FLY_MEASURE = {
			left: "-9999px",
			top: "0px",
			visibility: "hidden"
		};
		/**
		* Render the upward branch picker with its right-side confirm flyout.
		* @param props - anchor, rows, confirm bundle, callbacks, and the class sheet.
		* @returns null while closed or unplaced; otherwise the portaled card (+flyout).
		*/
		function BranchMenu({ open, anchorRef, rows, currentBranch, confirm, onSelect, onClose, t }) {
			const cardRef = (0, react.useRef)(null);
			const inputRef = (0, react.useRef)(null);
			/**
			* Search-field ref callback: focus the field the moment it mounts. The
			* card mounts in two stages (open flips, then pos resolves a render
			* later), so an [open]-keyed passive effect fires while the input is
			* still unmounted — its focus() no-ops against a null ref. Focusing at
			* mount time is immune to that race by construction.
			*/
			const holdSearchFocus = (el) => {
				inputRef.current = el;
				if (el !== null) el.focus();
			};
			const flyRef = (0, react.useRef)(null);
			const flyConfirmRef = (0, react.useRef)(null);
			/** The row whose pick is awaiting confirmation (anchoring element). */
			const pendingRef = (0, react.useRef)(null);
			/** Pending row's name — the placement-effect trigger: picking another
			* row while the flyout is open must re-anchor it (confirmOpen alone
			* stays true, so a ref mutation re-renders nothing). */
			const [pendingName, setPendingName] = (0, react.useState)(null);
			const [pos, setPos] = (0, react.useState)(null);
			const [flyPos, setFlyPos] = (0, react.useState)(null);
			const [query, setQuery] = (0, react.useState)("");
			const confirmRef = (0, react.useRef)(confirm);
			confirmRef.current = confirm;
			const confirmOpen = confirm !== null;
			(0, react.useLayoutEffect)(() => {
				if (!open) {
					setPos(null);
					return;
				}
				const place = () => {
					const anchor = anchorRef.current;
					if (anchor === null) return;
					const rect = anchor.getBoundingClientRect();
					const vw = window.innerWidth;
					const vh = window.innerHeight;
					const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, vw - CARD_WIDTH - MARGIN));
					setPos({
						left,
						bottom: vh - rect.top + GAP
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
				if (open) setQuery("");
			}, [open]);
			(0, react.useLayoutEffect)(() => {
				if (!confirmOpen || pendingName === null) {
					setFlyPos(null);
					return;
				}
				const place = () => {
					const pending = pendingRef.current;
					const fly = flyRef.current;
					const card = cardRef.current;
					if (pending === null || fly === null || card === null) return;
					const row = pending.el.getBoundingClientRect();
					const cr = card.getBoundingClientRect();
					const vw = window.innerWidth;
					const vh = window.innerHeight;
					const left = cr.right + GAP;
					const room = Math.min(FLY_MAX_WIDTH, Math.max(200, vw - MARGIN - left));
					fly.style.maxWidth = `${room}px`;
					const fw = fly.offsetWidth;
					const fh = fly.offsetHeight;
					const top = Math.min(Math.max(row.top + row.height / 2 - fh / 2, MARGIN), Math.max(MARGIN, vh - fh - MARGIN));
					setFlyPos({
						left: Math.min(left, vw - MARGIN - fw),
						top
					});
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [confirmOpen, pendingName]);
			(0, react.useEffect)(() => {
				if (confirmOpen && pendingName !== null) {
					const raf = requestAnimationFrame(() => {
						flyConfirmRef.current?.focus();
					});
					return () => {
						cancelAnimationFrame(raf);
					};
				}
				if (!confirmOpen) {
					pendingRef.current = null;
					setPendingName(null);
				}
			}, [confirmOpen, pendingName]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (cardRef.current?.contains(event.target) === true) return;
					if (flyRef.current?.contains(event.target) === true) return;
					if (anchorRef.current?.contains(event.target) === true) return;
					confirmRef.current?.onCancel();
					onClose();
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					if (confirmRef.current !== null) confirmRef.current.onCancel();
					else onClose();
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [
				open,
				onClose,
				anchorRef
			]);
			if (!open || pos === null) return null;
			const needle = query.trim().toLowerCase();
			const visible = needle === "" ? rows : rows.filter((row) => row.name.toLowerCase().includes(needle));
			/** Stage a pick: remember the row element (the flyout anchors beside
			* it), then hand the branch to the owner. Both entry paths — row click
			* and Enter-in-search — funnel through here so the flyout always has a
			* live anchor. */
			const pick = (el, name) => {
				if (el !== null) pendingRef.current = {
					name,
					el
				};
				setPendingName(name);
				onSelect(name);
			};
			/** Enter in the search field: commit the first enabled visible row
			* (its rendered button is the anchor — found by exact name match). */
			const commitFirst = () => {
				const first = visible.find((row) => !row.disabled);
				if (first === void 0) return;
				const el = [...cardRef.current?.querySelectorAll("button[role=\"menuitem\"]") ?? []].find((b) => (b.textContent ?? "").trim() === first.name) ?? null;
				pick(el, first.name);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: cardRef,
				className: BranchChip_module_default.menuCard,
				style: {
					left: pos.left,
					bottom: pos.bottom
				},
				role: "menu",
				"aria-label": t("menuLocalBranches"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: BranchChip_module_default.menuHeading,
						children: t("menuLocalBranches")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BranchChip_module_default.menuRows,
						role: "presentation",
						children: [visible.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "menuitem",
							className: BranchChip_module_default.menuRow,
							disabled: row.disabled,
							onClick: (event) => {
								pick(event.currentTarget, row.name);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BranchChip_module_default.menuRowLabel,
								children: row.name
							}), row.name === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })]
						}, row.name)), visible.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: BranchChip_module_default.menuEmpty,
							children: t("menuNoMatches")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: BranchChip_module_default.menuSearchWrap,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: holdSearchFocus,
							className: BranchChip_module_default.menuSearch,
							type: "text",
							value: query,
							placeholder: t("menuSearchPlaceholder"),
							"aria-label": t("menuSearchPlaceholder"),
							spellCheck: false,
							onChange: (event) => {
								setQuery(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commitFirst();
								}
							}
						})
					})
				]
			}), document.body), confirm !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: flyRef,
				className: BranchChip_module_default.popCard,
				style: flyPos ?? FLY_MEASURE,
				role: "dialog",
				"aria-label": confirm.ask,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BranchChip_module_default.popAsk,
					children: confirm.ask
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: BranchChip_module_default.popActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: confirm.busy,
						onClick: confirm.onCancel,
						children: confirm.cancelLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						ref: flyConfirmRef,
						type: "button",
						disabled: confirm.busy,
						onClick: confirm.onConfirm,
						children: confirm.confirmLabel
					})]
				})]
			}), document.body)] });
		}
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
		* Build the branch rows for the picker: local branches only (remote
		* branches are not offered). A branch already checked out by a live
		* worktree is disabled while the worktree toggle is off (git refuses such
		* a switch); with the toggle on it is the reuse path, so it stays
		* selectable. The selected row's trailing check is BranchMenu's own
		* affordance — no leading icon.
		*/
		function buildBranchRows(branches, worktrees, currentBranch, worktreeMode) {
			const occupied = new Set(worktrees.flatMap((w) => w.branch === void 0 ? [] : [w.branch]));
			return branches.filter((b) => b.kind === "local").map((branch) => ({
				name: branch.name,
				disabled: branch.name !== currentBranch && !worktreeMode && occupied.has(localBranchName(branch.name))
			}));
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
			(0, react.useEffect)(() => {
				const refreshIfIdle = () => {
					if (busyRef.current) return;
					refresh();
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") refreshIfIdle();
				};
				window.addEventListener("focus", refreshIfIdle);
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					window.removeEventListener("focus", refreshIfIdle);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [refresh]);
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
			const rows = (0, react.useMemo)(() => facts === null ? [] : buildBranchRows(facts.branches, facts.worktrees, facts.currentBranch, worktreeMode), [facts, worktreeMode]);
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
							setConfirm(null);
							const opening = !menuOpen;
							setMenuOpen(opening);
							if (opening && !busyRef.current) refresh();
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
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BranchMenu, {
					open: menuOpen,
					anchorRef: chipRef,
					rows,
					currentBranch: facts.currentBranch,
					confirm: confirm === null ? null : {
						ask: confirm.kind === "worktree" ? t(existingWorktree !== void 0 ? "worktreeAskReuse" : "worktreeAskNew", { branch: confirmLocalName }) : t("switchAsk", { branch: confirm.branch }),
						confirmLabel: busy ? confirm.kind === "worktree" ? t("worktreeBusy") : t("switchBusy") : t("actionConfirm"),
						cancelLabel: t("actionCancel"),
						busy,
						onConfirm: () => {
							if (confirm.kind === "worktree") doWorktree(confirm.branch);
							else doSwitch(confirm.branch);
						},
						onCancel: () => {
							if (!busy) setConfirm(null);
						}
					},
					onSelect: (branch) => {
						if (branch === facts.currentBranch) {
							setMenuOpen(false);
							return;
						}
						setConfirm({
							kind: worktreeMode ? "worktree" : "switch",
							branch
						});
					},
					onClose: () => {
						setMenuOpen(false);
					},
					t
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
		//#region \0git-worktree-css:E:\Documents\MyCode\oyw-dsh-plugin\dsh-git-worktree\src\client\SettingsSection.module.css?inline
		const css = "/* Settings section body: one labeled path input with its save action. */\n\n.body_1130298942 {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  max-width: 32em;\n}\n\n.description_1130298942 {\n  margin: 0;\n  color: color-mix(in srgb, currentColor 70%, transparent);\n  font-size: 13px;\n}\n\n.label_1130298942 {\n  font-size: 13px;\n  font-weight: 500;\n}\n\n.row_1130298942 {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n}\n\n.row_1130298942 > :first-child {\n  flex: 1;\n}\n\n/* Auto-save status note (\"Saving… / Saved\") after the browse button. */\n.status_1130298942 {\n  flex-shrink: 0;\n  color: var(--dsw-alias-label-primary-bluish, currentColor);\n  font-size: 12px;\n  white-space: nowrap;\n}\n\n.help_1130298942 {\n  margin: 0;\n  color: color-mix(in srgb, currentColor 55%, transparent);\n  font-size: 12px;\n}\n\n.error_1130298942 {\n  margin: 0;\n  color: var(--dsw-color-danger, #d5484f);\n  font-size: 12px;\n}\n";
		const tagId = "dsh-git-worktree/SettingsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-git-worktree/SettingsSection.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-git-worktree";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SettingsSection_module_default = {
			"body": "body_1130298942",
			"description": "description_1130298942",
			"label": "label_1130298942",
			"row": "row_1130298942",
			"status": "status_1130298942",
			"help": "help_1130298942",
			"error": "error_1130298942"
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
			menuSearchPlaceholder: "Search branches",
			menuNoMatches: "No matching branches",
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
			menuSearchPlaceholder: "搜索分支",
			menuNoMatches: "没有匹配的分支",
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