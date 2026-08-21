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
		//#endregion
		//#region src/wire.ts
		/**
		* Shared wire contract between the host half (HTTP routes under
		* `/plugin/git-worktree`) and the browser half (chip + plugin settings card).
		* Zero runtime dependencies: constants and types only, imported by both
		* builds.
		*/
		/** Absolute pathname prefix every route of this plugin lives under. */
		const ROUTE_PREFIX = "/plugin/git-worktree";
		/** GET ROUTE_PREFIX/status?path=<absolute dir> */
		const ROUTE_STATUS = `${ROUTE_PREFIX}/status`;
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
		const css$1 = "/* Branch chip row inside the composer tool row (conversation.input_1192525008.left_1192525008,\n * right of the mode chips). Modeled as a single rounded-rectangle\n * segmented control: the branch picker and the worktree toggle share one\n * container with a thin divider between them, so they read as one\n * affordance instead of two loose buttons.\n *\n * Geometry mirrors the composer trigger chips in the DSH base (see\n * PermissionSelect / ModelSelect): 28px height, 13/20 medium-secondary\n * label, transparent fill, no outline 鈥?the dock stays at the same\n * visual weight as the surrounding chips (dsh-worktree select, standard\n * mode select, Workspace Write, MiniMax-M3 High). The corners stop short\n * of the base's full pill (24px) so the silhouette stays a chip rather\n * than a capsule, per the design brief. */\n\n/* Shared trigger geometry 鈥?copied 1:1 from the base composer triggers\n * (PermissionSelect .trigger_1192525008 / ModelSelect .trigger_1192525008). Centralizing here\n * keeps the two segments visually fused so the divider reads as part of\n * one component, not two loose buttons. */\n.dock_1192525008 {\n  display: inline-flex;\n  align-items: stretch;\n  height: 28px;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  min-height: 28px;\n  overflow: hidden;\n}\n\n/* Vertical separator between the two segments. Uses the secondary label\n * color so it stays in the same tonal family as the surrounding trigger\n * outlines and chevrons. */\n.divider_1192525008 {\n  width: 1px;\n  margin: 6px 0;\n  background: color-mix(in srgb, currentColor 22%, transparent);\n  flex-shrink: 0;\n}\n\n.chip_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 8px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.chip_1192525008:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The leftmost segment rounds only its left corners so it tucks into the dock. */\n.chip_1192525008:first-child {\n  border-top-left-radius: 6px;\n  border-bottom-left-radius: 6px;\n}\n\n/* Started sessions drop the worktree segment: the lone chip rounds all\n * corners and reads as a plain button, not a broken-off half control. */\n.chip_1192525008:only-child {\n  border-radius: 6px;\n}\n\n.branch_1192525008 {\n  max-width: 16em;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.check_1192525008,\n.checkOn_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 4px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.check_1192525008:hover,\n.checkOn_1192525008:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The rightmost segment rounds only its right corners. */\n.check_1192525008:last-child,\n.checkOn_1192525008:last-child {\n  border-top-right-radius: 6px;\n  border-bottom-right-radius: 6px;\n}\n\n.box_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 14px;\n  height: 14px;\n  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);\n  border-radius: 4px;\n}\n\n/* Selected worktree: only the checkbox itself turns bluish and fills 鈥?the\n * surrounding button stays transparent so the label keeps the same\n * secondary tone. Mirrors the Claude Code toggle treatment. The inner\n * check rides the bluish fill with an inverted foreground token so the\n * glyph stays legible. */\n.checkOn_1192525008 .box_1192525008 {\n  border-color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  background: var(--dsw-alias-label-primary-bluish, #4186f0);\n  color: var(--dsw-alias-label-primary-foreground, #ffffff);\n}\n\n.checkLabel_1192525008 {\n  white-space: nowrap;\n}\n\n/* Confirm flyout: the second-level panel opening right of the branch\n * card (the base Menu's submenu posture: r12, inverted hairline,\n * shadow-lv3, --dsw-specific-menu). Width is content-driven — it follows\n * the branch name in the ask line — floored at 168px (the Cancel/Confirm\n * pair plus padding: short branch names must not squeeze the buttons into\n * wrapping \"切换中…\" mid-word) and capped at 400px; BranchMenu also clamps\n * it inline to the room right of the card. Beyond the cap the ask wraps.\n * border-box so every width arm includes the card chrome. */\n.popCard_1192525008 {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1000;\n  width: max-content;\n  min-width: 168px;\n  max-width: min(400px, 80vw);\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.popAsk_1192525008 {\n  margin: 0;\n  padding: 6px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: inherit;\n  /* Branch names are long unbroken tokens — plain wrapping would let them\n   * overflow the capped card instead of breaking. */\n  overflow-wrap: anywhere;\n}\n\n.popActions_1192525008 {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type.\n * nowrap keeps labels like 切换中… from splitting mid-word when the flyout\n * is pinned to its minimum width by a short branch name. */\n.popActions_1192525008 button {\n  flex: 1 1 0;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.popActions_1192525008 button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.popActions_1192525008 button:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.popActions_1192525008 button:last-child {\n  color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  font-weight: 500;\n}\n\n/* ── Branch picker popup (BranchMenu) ──────────────────────────────\n * Upward-opening card pinned above the chip, in the Menu's card chrome\n * (r12, inverted hairline, shadow-lv3, --dsw-specific-menu — same family\n * as .popCard_1192525008). Three owner requirements shape the geometry:\n *\n *   1. height cap: min(420px, 60vh) on the card, only the rows area\n *      scrolls (.menuRows_1192525008) — heading and search stay pinned;\n *   2. the search field sits pinned at the card's bottom edge, directly\n *      above the chip, with the scrolling rows above it;\n *   3. the card is CSS-`bottom`-pinned ~6px above the chip's top and so\n *      grows entirely upward — it can never cover the composer or fill\n *      the viewport, whatever the branch count.\n *\n * The inline `left`/`bottom` come from BranchMenu's placement pass; the\n * width is fixed here (design 360px — 320 tree + 40 tool strip — and\n * viewport-capped) so horizontal clamping stays deterministic without\n * measuring the card. */\n\n/* The portal lands directly under document.body_1192525008, outside the shell's\n * box-sizing reset — content-box default would add padding/border on top\n * of the declared width (360 became 370, and the width:100% children\n * padded 16px past the card's right clip, shearing off their rounded\n * corners). Every width-declared box in this popup opts back into\n * border-box: the card, the toolbar, the rows, and the search input. */\n.menuCard_1192525008 {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1000;\n  display: flex;\n  flex-direction: row;\n  width: min(360px, calc(100vw - 24px));\n  max-height: min(420px, 60vh);\n  overflow: hidden;\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n}\n\n/* Left tool strip (IDEA branch-panel posture at popup scale): a narrow\n * column of icon-only buttons for actions that do not belong in the tree\n * — locate the checked-out branch, expand/collapse the whole tree.\n * Buttons stack from the BOTTOM up: the card's height shrinks when the\n * repo has few branches, so a top-anchored strip would drift around and\n * the buttons would sit far from the search bar; anchoring to the bottom\n * pins them at a stable spot (beside the search row) whatever the height. */\n.menuToolbar_1192525008 {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  justify-content: flex-end;\n  gap: 2px;\n  flex-shrink: 0;\n  width: 32px;\n  padding: 0 2px;\n  margin-right: 4px;\n  border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);\n}\n\n.menuToolButton_1192525008 {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  margin: 0 auto;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  cursor: pointer;\n}\n\n.menuToolButton_1192525008:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n.menuToolButton_1192525008:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n/* The main column: heading + scrollable rows + pinned search. */\n.menuMain_1192525008 {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n/* Non-interactive group heading — the Menu label row's posture. */\n.menuHeading_1192525008 {\n  padding: 6px 8px 4px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  flex-shrink: 0;\n}\n\n/* The only scrollable region: shrinks within the capped card so the\n * heading above and the search below stay visible while rows scroll. */\n.menuRows_1192525008 {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type.\n * Weight 500 mirrors the chip's branch label (the portal escapes the\n * composer's font context, so the match must be explicit — the inherited\n * body weight is 400 and reads visibly lighter than the chip beside it). */\n.menuRow_1192525008 {\n  box-sizing: border-box; /* width:100% + padding must stay inside .menuRows_1192525008 */\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 28px;\n  padding: 4px 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.menuRow_1192525008:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The checked-out branch: a persistent tint a step above the resting rows\n * so it reads as \"you are here\" the moment the list scrolls it into view\n * (BranchMenu centers it on open) — the trailing check alone is easy to\n * miss from a distance. */\n.menuRowSelected_1192525008,\n.menuRowSelected_1192525008:hover:not(:disabled) {\n  background: color-mix(in srgb, currentColor 10%, transparent);\n}\n\n/* IDEA-style selection: the clicked row gets a bluish fill, layering over\n * the HEAD tint when the same row is both — selection communicates intent,\n * the HEAD tint communicates position, and they coexist (IDEA 4.4). */\n.menuRowPicked_1192525008,\n.menuRowPicked_1192525008:hover:not(:disabled) {\n  background: color-mix(in srgb, var(--dsw-alias-label-primary-bluish, #4186f0) 18%, transparent);\n}\n\n/* Occupied-worktree branches: dimmed, not clickable. */\n.menuRow_1192525008:disabled {\n  opacity: 0.45;\n  cursor: default;\n}\n\n.menuRowLabel_1192525008 {\n  flex: 1 1 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Search hit highlight (IDEA): the matched substring gets a warm tint\n * behind it — theme-agnostic, legible in both light and dark cards. */\n.menuSearchMark_1192525008 {\n  background: color-mix(in srgb, #b58900 38%, transparent);\n  border-radius: 2px;\n}\n\n/* Tree group rows (folder headers) — BranchMenu's '/' prefix tree: the\n * same row geometry as .menuRow_1192525008, but labeled in the secondary tone so the\n * leaf rows pop, with a count badge and a chevron that turns on expand. */\n.menuGroup_1192525008 {\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  width: 100%;\n  min-height: 28px;\n  padding: 4px 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  font: inherit;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.menuGroup_1192525008:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n.menuGroupLabel_1192525008 {\n  flex: 1 1 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.menuGroupChevron_1192525008 {\n  flex-shrink: 0;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 12px;\n  height: 12px;\n  transition: transform 120ms ease;\n}\n\n.menuGroupChevronOpen_1192525008 {\n  transform: rotate(90deg);\n}\n\n.menuGroupCount_1192525008 {\n  flex-shrink: 0;\n  font-size: 12px;\n  line-height: 20px;\n  font-weight: 400;\n  color: color-mix(in srgb, currentColor 55%, transparent);\n}\n\n/* Zero-search-hit state: centered secondary line inside the rows area. */\n.menuEmpty_1192525008 {\n  padding: 10px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  text-align: center;\n}\n\n/* Bottom-pinned search field, separated from the rows by a hairline.\n * Borderless so it reads as part of the card, focus shown as the\n * standard hover tint rather than an outline. */\n.menuSearchWrap_1192525008 {\n  flex-shrink: 0;\n  margin-top: 2px;\n  padding-top: 4px;\n  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);\n}\n\n.menuSearch_1192525008 {\n  box-sizing: border-box; /* width:100% + padding must stay inside the wrap */\n  width: 100%;\n  height: 30px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  /* Weight 500 mirrors the chip's branch label (see .menuRow_1192525008) — the portal\n   * escapes the composer's font context and would inherit body's 400. */\n  font-weight: 500;\n  line-height: 20px;\n}\n\n.menuSearch_1192525008::placeholder {\n  color: var(--dsw-alias-label-secondary, #81858c);\n}\n\n.menuSearch_1192525008:focus {\n  outline: none;\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n";
		const tagId$1 = "dsh-git-worktree/BranchChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId$1 + "\"]") === null) {
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
			"menuToolbar": "menuToolbar_1192525008",
			"menuToolButton": "menuToolButton_1192525008",
			"menuMain": "menuMain_1192525008",
			"menuHeading": "menuHeading_1192525008",
			"menuRow": "menuRow_1192525008",
			"menuRowSelected": "menuRowSelected_1192525008",
			"menuRowPicked": "menuRowPicked_1192525008",
			"menuRowLabel": "menuRowLabel_1192525008",
			"menuSearchMark": "menuSearchMark_1192525008",
			"menuGroup": "menuGroup_1192525008",
			"menuGroupLabel": "menuGroupLabel_1192525008",
			"menuGroupChevron": "menuGroupChevron_1192525008",
			"menuGroupChevronOpen": "menuGroupChevronOpen_1192525008",
			"menuGroupCount": "menuGroupCount_1192525008",
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
		* portal-fixed posture, with owner requirements baked in:
		*
		*   1. the card is capped at min(420px, 60vh) and only the branch rows
		*      scroll (heading, search, and the toolbar stay pinned);
		*   2. a search field is pinned at the card's bottom edge — the row list
		*      scrolls above it — filtering rows by case-insensitive substring
		*      while KEEPING the matching branches' ancestor folders (IDEA-style
		*      prune) and highlighting the hit substring;
		*   3. the card opens entirely above the chip: the CSS `bottom` pins its
		*      bottom edge ~6px above the chip's top, so it grows upward and can
		*      never cover the composer, whatever the branch count.
		*
		* Layout (IDEA branch-panel posture at popup scale): a narrow tool strip
		* on the left (locate-current + expand/collapse-all), then a main column
		* of heading / tree / search. Selection model borrowed from IDEA: a
		* single click SELECTS a row (blue); double-click or Enter then OPENS the
		* right-side confirm flyout for that row — the switch itself always goes
		* through the confirmation step, never straight away. While the confirm
		* flyout is open, clicking another row re-anchors it (the old one-click
		* pick flow).
		*
		* The confirm step is a second-level flyout opening to the RIGHT of the
		* branch card (the base Menu's submenu posture): the chip sits in the
		* bottom composer, so the old below-the-chip bubble landed off-viewport.
		* The flyout is a separate portal (not clipped by the card's
		* overflow:hidden), horizontally anchored to the card's right edge — it
		* can never overlap the branch list — and vertically centered on the
		* picked row. Its width is content-driven, capped in CSS, wrapping.
		*
		* Close semantics: outside pointerdown (card, flyout, and chip excluded)
		* cancels the confirm and closes the menu; Escape unwinds tier by tier —
		* confirm, then search text, then selection, then the menu; Enter in the
		* search field commits the first enabled visible row.
		*
		* Long names and many branches: a clipped label shows the full name on
		* hover via the native title (gated to actually-clipped rows only). When
		* the list grows past TREE_MIN_ROWS it renders as a full-depth '/' prefix
		* tree instead: folder-header rows (chevron + count) toggle; under an
		* expanded folder, child rows show only their own segment (indentation
		* carries the hierarchy — no repeated path, no color distinction); linear
		* chains compress into one row; the checked-out branch's chain opens by
		* default (centering still lands it mid-viewport).
		*/
		/** Viewport edge clearance, mirroring the base Menu portal margin. */
		const MARGIN = 12;
		/** Gap kept between the chip's top edge and the card's bottom edge. */
		const GAP = 6;
		/** Design card width — the CSS width's px arm; used for horizontal clamping. */
		const CARD_WIDTH = 360;
		/** Design flyout width cap — matches .popCard's max-width arm. */
		const FLY_MAX_WIDTH = 400;
		/** After a folder toggle, clicks arriving within this window are swallowed
		* (double-click misfire guard — see shiftGuardUntil in the component). */
		const CLICK_GUARD_MS = 250;
		/** Unplaced flyout: hidden but laid out at a fixed origin so offsetWidth/
		* offsetHeight are real for the measure-then-place pass (base Menu trick). */
		const FLY_MEASURE = {
			left: "-9999px",
			top: "0px",
			visibility: "hidden"
		};
		/** Below this many rows the picker stays a flat list: in small repos a
		* tree would hide real branches behind one-entry folders, buying nothing. */
		const TREE_MIN_ROWS = 8;
		const segCmp = (a, b) => a.localeCompare(b, void 0, {
			numeric: true,
			sensitivity: "base"
		});
		/** Build the prefix tree of the rows (see TreeNode). */
		function buildTree(rows) {
			const root = [];
			const find = (level, segment) => level.find((n) => n.segment === segment);
			for (const row of rows) {
				const segs = row.name.split("/").filter((s) => s !== "");
				let level = root;
				let path = "";
				for (let i = 0; i < segs.length; i += 1) {
					path = path === "" ? segs[i] : `${path}/${segs[i]}`;
					let node = find(level, segs[i]);
					if (node === void 0) {
						node = {
							segment: segs[i],
							path,
							depth: i,
							leaf: null,
							children: [],
							total: 0
						};
						level.push(node);
					}
					if (i === segs.length - 1) node.leaf = row;
					level = node.children;
				}
			}
			const finish = (nodes) => {
				for (const node of nodes) finish(node.children);
				nodes.sort((a, b) => {
					const af = a.children.length > 0 ? 0 : 1;
					const bf = b.children.length > 0 ? 0 : 1;
					return af !== bf ? af - bf : segCmp(a.segment, b.segment);
				});
			};
			finish(root);
			const count = (nodes) => {
				for (const node of nodes) {
					count(node.children);
					node.total = (node.leaf === null ? 0 : 1) + node.children.reduce((sum, c) => sum + c.total, 0);
				}
			};
			count(root);
			return root;
		}
		/** The folders that must start expanded so the checked-out branch is
		* immediately visible in the tree: every proper ancestor of its path. */
		function chainExpanded(branch) {
			const segs = branch.split("/").filter((s) => s !== "");
			const set = /* @__PURE__ */ new Set();
			let path = "";
			for (let i = 0; i < segs.length - 1; i += 1) {
				path = path === "" ? segs[i] : `${path}/${segs[i]}`;
				set.add(path);
			}
			return set;
		}
		/** Hover tooltip: set the native `title` ONLY when the label is actually
		* clipped (scrollWidth > clientWidth) — fitted names show no tooltip, and
		* long ones expose their full path without a custom bubble. The target is
		* the label span (first span child), the clipped element. */
		const gateTooltip = (button, name) => {
			const label = button.querySelector(":scope > span");
			if (label !== null) label.title = label.scrollWidth > label.clientWidth ? name : "";
		};
		/** Leaving a row drops its tooltip so a recycled DOM node (search refilter)
		* can never show a stale title for another branch. */
		const clearTooltip = (button) => {
			const label = button.querySelector(":scope > span");
			if (label !== null) label.title = "";
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
			/** Expanded folder set, keyed by node path. Re-seeded on every open so
			* the current branch's chain is visible without re-expanding by hand. */
			const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
			/** IDEA-style selection: clicked row (blue). Zero or one at a time. */
			const [selected, setSelected] = (0, react.useState)(null);
			const confirmRef = (0, react.useRef)(confirm);
			confirmRef.current = confirm;
			const queryRef = (0, react.useRef)(query);
			queryRef.current = query;
			const selectedRef = (0, react.useRef)(selected);
			selectedRef.current = selected;
			/** Always-fresh pick for the stale-safe document keydown listener. */
			const pickRef = (0, react.useRef)(() => {});
			const confirmOpen = confirm !== null;
			/**
			* Double-click misfire guard: toggling a folder shifts the layout — the
			* second click of a double-click can land on a row that slid under the
			* cursor (a branch!), which would select it or pop the switch flyout.
			* After a folder toggle, every click swallowed for CLICK_GUARD_MS, so a
			* double-click on a folder expands it exactly once and never bleeds into
			* a branch click. Branch-row clicks do not arm the guard (selecting does
			* not move anything), so row double-clicks keep working instantly.
			*/
			const shiftGuardUntil = (0, react.useRef)(0);
			const guardActive = () => Date.now() < shiftGuardUntil.current;
			const armShiftGuard = () => {
				shiftGuardUntil.current = Date.now() + CLICK_GUARD_MS;
			};
			/** Stage a pick: remember the row element (the flyout anchors beside
			* it), then hand the branch to the owner. All pick paths — search Enter,
			* keyboard Enter on a selected row — funnel through here. */
			const pick = (el, name) => {
				if (el !== null) pendingRef.current = {
					name,
					el
				};
				setPendingName(name);
				onSelect(name);
			};
			pickRef.current = pick;
			/** Prefix tree when the list is big enough to need one; null (flat list)
			* below TREE_MIN_ROWS. Built once per rows change. */
			const tree = (0, react.useMemo)(() => rows.length > TREE_MIN_ROWS ? buildTree(rows) : null, [rows]);
			/** Every folder path that renders a header — the expand/collapse-all
			* button's scope. */
			const folderPaths = (0, react.useMemo)(() => {
				const out = [];
				const walk = (nodes) => {
					for (const node of nodes) {
						if (node.children.length > 0) out.push(node.path);
						walk(node.children);
					}
				};
				if (tree !== null) walk(tree);
				return out;
			}, [tree]);
			const allExpanded = folderPaths.length > 0 && folderPaths.every((p) => expanded.has(p));
			const toggleAll = () => {
				setExpanded(allExpanded ? /* @__PURE__ */ new Set() : new Set(folderPaths));
			};
			const locateCurrent = () => {
				setExpanded((prev) => {
					const next = new Set(prev);
					for (const p of chainExpanded(currentBranch)) next.add(p);
					return next;
				});
				requestAnimationFrame(() => {
					if (rowsRef.current !== null) centerCurrentRow(rowsRef.current);
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				setQuery("");
				setSelected(null);
				setExpanded(chainExpanded(currentBranch));
			}, [open, currentBranch]);
			(0, react.useEffect)(() => {
				if (selected !== null && !rows.some((r) => r.name === selected)) setSelected(null);
			}, [rows, selected]);
			/** Toggle one folder header. */
			const toggle = (path) => {
				setExpanded((prev) => {
					const next = new Set(prev);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			};
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
			const rowsRef = (0, react.useRef)(null);
			const centerCurrentRow = (0, react.useCallback)((viewport) => {
				const row = [...viewport.querySelectorAll("button[role=\"menuitem\"][data-branch]")].find((b) => (b.dataset.branch ?? "") === currentBranch);
				if (row === void 0) return;
				const rowRect = row.getBoundingClientRect();
				const vpRect = viewport.getBoundingClientRect();
				const target = viewport.scrollTop + (rowRect.top - vpRect.top) - (viewport.clientHeight - rowRect.height) / 2;
				viewport.scrollTo({ top: Math.max(0, target) });
			}, [currentBranch]);
			const holdRowsCenter = (0, react.useCallback)((el) => {
				rowsRef.current = el;
				if (el !== null) centerCurrentRow(el);
			}, [centerCurrentRow]);
			(0, react.useEffect)(() => {
				if (!open || query.trim() !== "") return;
				if (rowsRef.current !== null) centerCurrentRow(rowsRef.current);
			}, [
				open,
				query,
				centerCurrentRow
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const raf = requestAnimationFrame(() => {
					if (rowsRef.current !== null) centerCurrentRow(rowsRef.current);
				});
				return () => {
					cancelAnimationFrame(raf);
				};
			}, [open, centerCurrentRow]);
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
					const key = event.key;
					if (key === "Escape") {
						if (confirmRef.current !== null) {
							confirmRef.current.onCancel();
							return;
						}
						if (queryRef.current.trim() !== "") {
							setQuery("");
							return;
						}
						if (selectedRef.current !== null) {
							setSelected(null);
							return;
						}
						onClose();
						return;
					}
					const card = cardRef.current;
					const active = document.activeElement;
					if (card === null || active === null || !card.contains(active)) return;
					if (active === card.querySelector("input")) return;
					const leaves = [...card.querySelectorAll("button[role=\"menuitem\"][data-branch]")];
					if (key === "ArrowDown" || key === "ArrowUp") {
						event.preventDefault();
						if (leaves.length === 0) return;
						const idx = leaves.findIndex((b) => (b.dataset.branch ?? "") === selectedRef.current);
						let next = idx;
						if (key === "ArrowDown") next = idx < 0 ? 0 : Math.min(leaves.length - 1, idx + 1);
						else next = idx <= 0 ? leaves.length - 1 : idx - 1;
						const target = leaves[next];
						const name = target.dataset.branch ?? null;
						if (name !== null) setSelected(name);
						target.focus();
						target.scrollIntoView({ block: "nearest" });
					} else if (key === "Enter" && selectedRef.current !== null) {
						event.preventDefault();
						const el = leaves.find((b) => (b.dataset.branch ?? "") === selectedRef.current) ?? null;
						pickRef.current(el, selectedRef.current);
					}
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
			/** Enter in the search field: commit the first enabled visible row
			* (its rendered button is the anchor — found by its data-branch key; the
			* label text alone can't identify a row inside a tree). */
			const commitFirst = () => {
				const first = visible.find((row) => !row.disabled);
				if (first === void 0) return;
				const card = cardRef.current;
				if (card === null) return;
				const el = card.querySelector(`button[data-branch="${CSS.escape(first.name)}"]`);
				pick(el, first.name);
			};
			/** Row class composition: base + HEAD tint + selection (selection wins). */
			const rowClass = (name) => {
				let cls = BranchChip_module_default.menuRow;
				if (name === currentBranch) cls += ` ${BranchChip_module_default.menuRowSelected}`;
				if (name === selected) cls += ` ${BranchChip_module_default.menuRowPicked}`;
				return cls;
			};
			/** A row's click behavior: with the confirm flyout open, clicking a row
			* re-picks it (the old one-click flow — the flyout re-anchors); without
			* one it just selects (IDEA model — double-click or Enter opens the
			* confirm flyout for the selected row). */
			const rowClick = (el, name) => {
				if (confirmOpen) pick(el, name);
				else setSelected(name);
			};
			/** Wrap every case-insensitive occurrence of `needle` in `text` with the
			* search-mark span (IDEA-style hit highlight). */
			const renderLabel = (text) => {
				if (needle === "") return text;
				const out = [];
				let rest = text;
				let key = 0;
				for (;;) {
					const idx = rest.toLowerCase().indexOf(needle);
					if (idx === -1) {
						out.push(rest);
						break;
					}
					if (idx > 0) out.push(rest.slice(0, idx));
					out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: BranchChip_module_default.menuSearchMark,
						children: rest.slice(idx, idx + needle.length)
					}, key));
					key += 1;
					rest = rest.slice(idx + needle.length);
				}
				return out;
			};
			/** Does any leaf under these nodes match the needle? */
			const subtreeMatches = (nodes) => {
				for (const node of nodes) {
					if (node.leaf !== null && node.leaf.name.toLowerCase().includes(needle)) return true;
					if (subtreeMatches(node.children)) return true;
				}
				return false;
			};
			/** One tree group-header row: its own segment (a compressed chain's
			* walked segments join the label), a count badge, and a chevron that
			* turns for expansion. Clicking toggles. One color throughout — the
			* folder path is not color-distinguished from the name. */
			const renderHeader = (node, label, depth) => {
				const isOpen = expanded.has(node.path);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: BranchChip_module_default.menuGroup,
					"data-group": node.path,
					style: { paddingLeft: 8 + depth * 12 },
					"aria-expanded": isOpen,
					onClick: () => {
						if (guardActive()) return;
						toggle(node.path);
						armShiftGuard();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
							size: 12,
							className: isOpen ? `${BranchChip_module_default.menuGroupChevron} ${BranchChip_module_default.menuGroupChevronOpen}` : BranchChip_module_default.menuGroupChevron
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.menuGroupLabel,
							children: label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: BranchChip_module_default.menuGroupCount,
							children: [
								"(",
								node.total,
								")"
							]
						})
					]
				}, `group:${node.path}`);
			};
			/** One tree leaf row: under an expanded folder it shows only its own
			* segment (indentation carries the hierarchy — no repeated full path);
			* a compressed linear chain keeps its walked segments in the label so
			* the context survives without a pointless one-entry folder. */
			const renderLeaf = (node, label, depth) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitem",
				"data-branch": node.path,
				className: rowClass(node.path),
				disabled: node.leaf?.disabled ?? false,
				style: { paddingLeft: 8 + depth * 12 },
				onClick: () => {
					if (guardActive()) return;
					rowClick(buttonOf(node.path), node.path);
				},
				onDoubleClick: (event) => {
					if (guardActive()) return;
					pick(event.currentTarget, node.path);
				},
				onMouseEnter: (event) => {
					gateTooltip(event.currentTarget, node.path);
				},
				onMouseLeave: (event) => {
					clearTooltip(event.currentTarget);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: BranchChip_module_default.menuRowLabel,
					children: label
				}), node.path === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })]
			}, node.path);
			/** Recursive tree renderer. Linear chains — nodes that are neither a
			* branch nor a real fork — compress into the next row's label, so
			* `feature/优化` stays a single flat row instead of a pointless one-entry
			* folder, while a real fork (`a/deep/tree` holding leaf1+leaf2) gets a
			* header whose children show only their own segments. */
			const renderTree = (nodes, depth) => {
				const out = [];
				for (const node of nodes) {
					let cur = node;
					const parts = [];
					while (cur.leaf === null && cur.children.length === 1) {
						parts.push(cur.segment);
						cur = cur.children[0];
					}
					const label = parts.length === 0 ? cur.segment : `${parts.join("/")}/${cur.segment}`;
					if (cur.leaf !== null) {
						out.push(renderLeaf(cur, label, depth));
						if (cur.children.length > 0) {
							out.push(renderHeader(cur, label, depth));
							if (expanded.has(cur.path)) out.push(...renderTree(cur.children, depth + 1));
						}
					} else {
						out.push(renderHeader(cur, label, depth));
						if (expanded.has(cur.path)) out.push(...renderTree(cur.children, depth + 1));
					}
				}
				return out;
			};
			/** Search view: keep matching leaves AND their ancestor folders (IDEA's
			* filter keeps the path), hide non-matching siblings, force every kept
			* folder open, and highlight the hit substring. No chain compression —
			* the full ancestor path is exactly the context the search is for. */
			const renderSearch = (nodes, depth) => {
				const out = [];
				for (const node of nodes) {
					const leafHit = node.leaf !== null && node.leaf.name.toLowerCase().includes(needle);
					const childHit = subtreeMatches(node.children);
					if (leafHit) out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						role: "menuitem",
						"data-branch": node.path,
						className: rowClass(node.path),
						disabled: node.leaf?.disabled ?? false,
						style: { paddingLeft: 8 + depth * 12 },
						onClick: () => {
							if (guardActive()) return;
							rowClick(buttonOf(node.path), node.path);
						},
						onDoubleClick: (event) => {
							if (guardActive()) return;
							pick(event.currentTarget, node.path);
						},
						onMouseEnter: (event) => {
							gateTooltip(event.currentTarget, node.path);
						},
						onMouseLeave: (event) => {
							clearTooltip(event.currentTarget);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.menuRowLabel,
							children: renderLabel(node.segment)
						}), node.path === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })]
					}, node.path));
					if (childHit) {
						out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							role: "presentation",
							className: BranchChip_module_default.menuGroup,
							"data-group": node.path,
							style: { paddingLeft: 8 + depth * 12 },
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
									size: 12,
									className: BranchChip_module_default.menuGroupChevron
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BranchChip_module_default.menuGroupLabel,
									children: renderLabel(node.segment)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: BranchChip_module_default.menuGroupCount,
									children: [
										"(",
										node.total,
										")"
									]
								})
							]
						}, `search:${node.path}`));
						out.push(...renderSearch(node.children, depth + 1));
					}
				}
				return out;
			};
			/** The rendered button for a branch name (flyout anchor on click-select
			* paths, where the handler only has the name at hand). */
			const buttonOf = (name) => cardRef.current?.querySelector(`button[data-branch="${CSS.escape(name)}"]`) ?? null;
			/** One flat row (small repos, and search results there). */
			const renderRow = (row, highlight) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitem",
				"data-branch": row.name,
				className: rowClass(row.name),
				disabled: row.disabled,
				onClick: () => {
					if (guardActive()) return;
					rowClick(buttonOf(row.name), row.name);
				},
				onDoubleClick: (event) => {
					if (guardActive()) return;
					pick(event.currentTarget, row.name);
				},
				onMouseEnter: (event) => {
					gateTooltip(event.currentTarget, row.name);
				},
				onMouseLeave: (event) => {
					clearTooltip(event.currentTarget);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: BranchChip_module_default.menuRowLabel,
					children: highlight ? renderLabel(row.name) : row.name
				}), row.name === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })]
			}, row.name);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: cardRef,
				className: BranchChip_module_default.menuCard,
				style: {
					left: pos.left,
					bottom: pos.bottom
				},
				role: "menu",
				"aria-label": t("menuLocalBranches"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: BranchChip_module_default.menuToolbar,
					role: "toolbar",
					"aria-label": t("menuLocalBranches"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: BranchChip_module_default.menuToolButton,
						title: t("menuLocate"),
						"aria-label": t("menuLocate"),
						onClick: locateCurrent,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGoalOutline16, { size: 16 })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: BranchChip_module_default.menuToolButton,
						title: allExpanded ? t("menuCollapseAll") : t("menuExpandAll"),
						"aria-label": allExpanded ? t("menuCollapseAll") : t("menuExpandAll"),
						disabled: tree === null || folderPaths.length === 0,
						onClick: toggleAll,
						children: allExpanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutline14, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { size: 14 })
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: BranchChip_module_default.menuMain,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: BranchChip_module_default.menuHeading,
							children: t("menuLocalBranches")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BranchChip_module_default.menuRows,
							role: "presentation",
							ref: holdRowsCenter,
							children: [tree === null ? (needle === "" ? rows : visible).map((row) => renderRow(row, needle !== "")) : needle === "" ? renderTree(tree, 0) : renderSearch(tree, 0), visible.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
				})]
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
						title: facts.currentBranch,
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
		//#region src/client/card-form.ts
		/** The field this card edits. */
		const ROOT_FIELD = "rootDir";
		/**
		* Stages the settings edit over the `git-worktree` scope.
		*
		* The form publishes through a snapshot store because the slot component
		* reads through a snapshot selector while both the scope and the local draft
		* change underneath; every projection is rebuilt from the two together. The
		* field is staged only when the user touched it, so a save writes a sparse
		* patch and never restates fields it did not see.
		*/
		var CardForm = class {
			scope;
			snapshotValue;
			listeners = /* @__PURE__ */ new Set();
			draft;
			saving = false;
			failed = false;
			/**
			* @param scope - the bound settings scope for the `git-worktree` namespace.
			*/
			constructor(scope) {
				this.scope = scope;
				this.snapshotValue = this.project();
				scope.subscribe(() => {
					this.publish();
				});
			}
			/** @returns the store the card's component reads through its bound selector. */
			bind() {
				return {
					getSnapshot: () => this.snapshotValue,
					subscribe: (listener) => {
						this.listeners.add(listener);
						return () => {
							this.listeners.delete(listener);
						};
					},
					set: (next) => {
						this.store(next);
					}
				};
			}
			/** @returns the edit, clear, save, and discard actions bound to this form. */
			actions() {
				return {
					editRoot: (text) => {
						this.draft = text;
						this.failed = false;
						this.publish();
					},
					clearRoot: () => {
						this.draft = "";
						this.failed = false;
						this.publish();
					},
					save: () => this.save(),
					discard: () => {
						if (this.draft === void 0 && !this.failed) return;
						this.draft = void 0;
						this.failed = false;
						this.publish();
					}
				};
			}
			/**
			* Write the staged edit, then re-seed from what the Host accepted.
			*
			* The Host is the only authority on acceptance — an empty draft clears the
			* field, anything else stores the trimmed text (so blanking the control and
			* saving is the same gesture as clearing it). A save that did not land
			* keeps its draft so the user can correct it instead of retyping.
			*/
			async save() {
				if (this.draft === void 0 || this.saving) return;
				const intended = this.draft.trim();
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				try {
					if (intended === "") await this.scope.unset(ROOT_FIELD);
					else await this.scope.set(ROOT_FIELD, intended);
					if (intended === "" ? this.storedRoot() : this.storedRootValue() !== intended) landed = false;
				} catch (_settingsWriteFailure) {
					landed = false;
				}
				if (landed) this.draft = void 0;
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			/** The raw user layer narrowed to a record; the wire answer is `unknown`. */
			userLayer() {
				const user = this.scope.getSnapshot().user;
				return typeof user === "object" && user !== null ? user : void 0;
			}
			/** Whether the user layer carries the root field. */
			storedRoot() {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, "rootDir");
			}
			/** The raw user-layer value of the root field. */
			storedRootValue() {
				return this.userLayer()?.[ROOT_FIELD];
			}
			/** The resolved (draft-free) text of the field; '' means inherited. */
			effectiveRoot() {
				const value = this.scope.getSnapshot().value?.[ROOT_FIELD];
				return typeof value === "string" ? value : "";
			}
			project() {
				const snapshot = this.scope.getSnapshot();
				const draft = this.draft ?? this.effectiveRoot();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					rootDir: draft,
					overridden: this.draft !== void 0 ? this.draft.trim() !== "" : this.storedRoot(),
					dirty: this.draft !== void 0 && this.draft !== this.effectiveRoot(),
					saving: this.saving,
					failed: this.failed
				};
			}
			/** Replace the snapshot reference and notify, only when the fact moved. */
			store(next) {
				if (next === this.snapshotValue) return;
				this.snapshotValue = next;
				for (const listener of this.listeners) listener();
			}
			publish() {
				this.store(this.project());
			}
		};
		//#endregion
		//#region \0git-worktree-css:E:\Documents\MyCode\oyw-dsh-plugin\dsh-git-worktree\src\client\GitWorktreeCard.module.css?inline
		const css = "/* git-worktree settings card on the Plugins configuration tab. Visual\n * language mirrors the settings section's own card chrome (border radius,\n * layer fills, pending badge, footer buttons) so cards from different\n * packages sit in one list without reading as two designs; tokens only, no\n * literal colors. */\n\n.card_1770191183 {\n  list-style: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 12px;\n  background: var(--dsw-alias-bg-layer-3);\n  transition: border-color .16s, background .16s;\n}\n\n.card_1770191183:hover {\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n/* An open card reads as the one being worked on, not merely taller. */\n.cardOpen_1770191183 {\n  background: var(--dsw-alias-bg-layer-2);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n.header_1770191183 {\n  width: 100%;\n  appearance: none;\n  border: 0;\n  background: none;\n  font: inherit;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 14px 16px;\n  border-radius: 12px;\n}\n\n.header_1770191183:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: -2px;\n}\n\n/* Name over description, mirroring the section's own plugin cards: the\n * description is what tells one plugin's settings from another's. */\n.headText_1770191183 {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.name_1770191183 {\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 1.4;\n  color: var(--dsw-alias-label-primary);\n}\n\n.description_1770191183 {\n  font-size: 13px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Carried on the header so a collapsed card still says it holds edits. */\n.pending_1770191183 {\n  flex: none;\n  border-radius: 999px;\n  padding: 1px 8px;\n  font-size: 11px;\n  line-height: 17px;\n  font-weight: 500;\n  white-space: nowrap;\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.chevron_1770191183 {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n  transition: transform .16s;\n}\n\n.chevronOpen_1770191183 {\n  transform: rotate(180deg);\n}\n\n.body_1770191183 {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  margin: 0 16px;\n  padding: 12px 0 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.note_1770191183 {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.field_1770191183 {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.fieldLabel_1770191183 {\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.input_1770191183 {\n  box-sizing: border-box;\n  width: 100%;\n  padding: 4px 8px;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-bg-layer-2);\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  appearance: none;\n}\n\n.input_1770191183:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: -1px;\n}\n\n.input_1770191183:disabled {\n  opacity: 0.6;\n}\n\n/* The directory control and its native-dialog launcher share one row. */\n.inputRow_1770191183 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.inputRow_1770191183 .input_1770191183 {\n  flex: 1;\n  min-width: 0;\n}\n\n.browse_1770191183 {\n  appearance: none;\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 4px 10px;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary);\n  background: none;\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.browse_1770191183:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n.browse_1770191183:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n.browse_1770191183:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n.hint_1770191183 {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.footer_1770191183 {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 8px 0 4px;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n}\n\n.failed_1770191183 {\n  flex: 1;\n  min-width: 0;\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-error);\n}\n\n.discard_1770191183,\n.save_1770191183 {\n  appearance: none;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  padding: 5px 14px;\n  font: inherit;\n  font-size: 13px;\n  line-height: 1.5;\n  cursor: pointer;\n}\n\n.discard_1770191183 {\n  border-color: var(--dsw-alias-border-l2);\n  background: none;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.discard_1770191183:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n.save_1770191183 {\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-bg-layer-3);\n}\n\n.discard_1770191183:disabled,\n.save_1770191183:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n.discard_1770191183:focus-visible,\n.save_1770191183:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n";
		const tagId = "dsh-git-worktree/GitWorktreeCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-git-worktree";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var GitWorktreeCard_module_default = {
			"card": "card_1770191183",
			"cardOpen": "cardOpen_1770191183",
			"header": "header_1770191183",
			"headText": "headText_1770191183",
			"name": "name_1770191183",
			"description": "description_1770191183",
			"pending": "pending_1770191183",
			"chevron": "chevron_1770191183",
			"chevronOpen": "chevronOpen_1770191183",
			"body": "body_1770191183",
			"note": "note_1770191183",
			"field": "field_1770191183",
			"fieldLabel": "fieldLabel_1770191183",
			"input": "input_1770191183",
			"inputRow": "inputRow_1770191183",
			"browse": "browse_1770191183",
			"hint": "hint_1770191183",
			"footer": "footer_1770191183",
			"failed": "failed_1770191183",
			"discard": "discard_1770191183",
			"save": "save_1770191183"
		};
		//#endregion
		//#region src/client/GitWorktreeCard.tsx
		/**
		* The git-worktree card on the Plugins configuration tab: a collapsible row
		* whose header names the plugin over a one-line description of what its
		* settings govern, disclosing the storage-root control when open. The card
		* owns everything inside it — chrome, controls, and copy — per the keyed-slot
		* contract; the tab only dispatches it under the `git-worktree` namespace
		* key.
		*
		* Renders nothing while the namespace is unavailable: a deployment that did
		* not compose the host half shows no trace of the card. A stored root edit
		* takes effect live (the Host routes read the section source per request);
		* no data moves — worktrees already created stay where they are, and git
		* itself still lists and reuses them.
		*
		* @module git-worktree/client/GitWorktreeCard
		*/
		/**
		* Render the git-worktree settings card.
		* @param props - locale copy, the card snapshot, and its form actions.
		* @returns the card, or nothing when the namespace is unavailable.
		*/
		function GitWorktreeCard(props) {
			const [open, setOpen] = (0, react.useState)(false);
			const [picking, setPicking] = (0, react.useState)(false);
			const { t } = props;
			const state = props.useGitWorktreeCard((snapshot) => snapshot);
			if (!state.available) return null;
			const lockInput = !state.writable;
			const lockActions = !state.dirty || state.saving;
			/**
			* Open the shell's native folder dialog and stage the chosen path — the
			* same picker the workspace flows use, driven through the injected
			* workspace service. A dismissal leaves the staged draft exactly as it
			* was; the text input stays the fallback either way.
			*/
			const browse = async () => {
				if (picking || lockInput) return;
				setPicking(true);
				try {
					const picked = await props.pickDirectory();
					if (picked !== null && picked !== "") props.editRoot(picked);
				} catch (_pickFailure) {} finally {
					setPicking(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: open ? `${GitWorktreeCard_module_default.card} ${GitWorktreeCard_module_default.cardOpen}` : GitWorktreeCard_module_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: GitWorktreeCard_module_default.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "cardCollapse" : "cardExpand")}: ${t("cardTitle")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: GitWorktreeCard_module_default.headText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitWorktreeCard_module_default.name,
								children: t("cardTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitWorktreeCard_module_default.description,
								children: t("cardDescription")
							})]
						}),
						state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GitWorktreeCard_module_default.pending,
							children: t("cardUnsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: open ? `${GitWorktreeCard_module_default.chevron} ${GitWorktreeCard_module_default.chevronOpen}` : GitWorktreeCard_module_default.chevron })
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitWorktreeCard_module_default.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitWorktreeCard_module_default.note,
							role: "status",
							children: t("cardReadOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: GitWorktreeCard_module_default.field,
							htmlFor: "git-worktree-card-root-dir",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitWorktreeCard_module_default.fieldLabel,
								children: t("cardRootDirLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: GitWorktreeCard_module_default.inputRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "git-worktree-card-root-dir",
									className: GitWorktreeCard_module_default.input,
									type: "text",
									spellCheck: false,
									value: state.rootDir,
									disabled: lockInput,
									onChange: (event) => {
										props.editRoot(event.target.value);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: GitWorktreeCard_module_default.browse,
									disabled: lockInput || picking,
									onClick: () => {
										browse();
									},
									children: t(picking ? "cardPicking" : "cardBrowse")
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: GitWorktreeCard_module_default.hint,
							children: [t("cardRootDirHint"), state.overridden ? ` ${t("cardOverridden")}` : ""]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitWorktreeCard_module_default.footer,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: GitWorktreeCard_module_default.failed,
									role: "status",
									children: t("cardSaveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: GitWorktreeCard_module_default.discard,
									disabled: lockActions,
									onClick: props.discard,
									children: t("cardDiscard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: GitWorktreeCard_module_default.save,
									disabled: lockActions,
									onClick: props.save,
									children: t(state.saving ? "cardSaving" : "cardSave")
								})
							]
						})
					]
				}) : null]
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
			menuLocate: "Locate current branch",
			menuExpandAll: "Expand all",
			menuCollapseAll: "Collapse all",
			switchAsk: "Switch to {branch}?",
			switchBusy: "Switching…",
			worktreeAskNew: "Create a worktree from {branch}?",
			worktreeAskReuse: "Switch to the {branch} worktree?",
			worktreeBusy: "Creating…",
			actionCancel: "Cancel",
			actionConfirm: "Confirm",
			errorGeneric: "Git worktree: {message}",
			cardTitle: "Git Worktree",
			cardDescription: "Where isolated worktree folders for new sessions are stored.",
			cardUnsaved: "Unsaved",
			cardExpand: "Expand",
			cardCollapse: "Collapse",
			cardReadOnly: "The settings document is read-only; edits cannot be saved.",
			cardRootDirLabel: "Worktree storage folder",
			cardBrowse: "Browse…",
			cardPicking: "Choosing…",
			cardRootDirHint: "Absolute path. Empty uses the default $DSH_HOME/gitworktree (~/.dsh/gitworktree).",
			cardOverridden: "(custom location)",
			cardSaveFailed: "The change did not save. Check the path is absolute and try again.",
			cardDiscard: "Discard",
			cardSave: "Save",
			cardSaving: "Saving…"
		};
		/** 中文词典。 */
		const zh = {
			chipWorktree: "工作树",
			worktreeToggle: "创建隔离工作树",
			menuLocalBranches: "本地分支",
			menuSearchPlaceholder: "搜索分支",
			menuNoMatches: "没有匹配的分支",
			menuLocate: "定位当前分支",
			menuExpandAll: "全部展开",
			menuCollapseAll: "全部折叠",
			switchAsk: "是否切到 {branch}？",
			switchBusy: "切换中…",
			worktreeAskNew: "是否从 {branch} 新建工作树？",
			worktreeAskReuse: "是否切到 {branch} 工作树？",
			worktreeBusy: "创建中…",
			actionCancel: "取消",
			actionConfirm: "确认",
			errorGeneric: "Git 工作树：{message}",
			cardTitle: "Git 工作树",
			cardDescription: "新会话的隔离工作树文件夹存放位置。",
			cardUnsaved: "未保存",
			cardExpand: "展开",
			cardCollapse: "折叠",
			cardReadOnly: "设置文档为只读，修改无法保存。",
			cardRootDirLabel: "工作树存放目录",
			cardBrowse: "浏览…",
			cardPicking: "选择中…",
			cardRootDirHint: "绝对路径。留空使用默认 $DSH_HOME/gitworktree（~/.dsh/gitworktree）。",
			cardOverridden: "（已自定义位置）",
			cardSaveFailed: "保存未生效，请检查路径是否为绝对路径后重试。",
			cardDiscard: "放弃",
			cardSave: "保存",
			cardSaving: "保存中…"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "git-worktree";
		/**
		* Namespace of the git-worktree settings section. Spelled here rather than
		* imported: a client package must not depend on a Host package.
		*/
		const GIT_WORKTREE_NS = "git-worktree";
		/** Required services: the slot ledger, session/workspace runtime, copy, and
		* the settings scope backing the plugin configuration card. */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"locale",
			"connection",
			"remote",
			"settingsScope"
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
			const form = new CardForm(ctx.settingsScope.bind({ namespace: GIT_WORKTREE_NS }));
			const store = form.bind();
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: GIT_WORKTREE_NS,
				locale: NS,
				inject: () => ({
					hooks: { gitWorktreeCard: store },
					...form.actions(),
					pickDirectory: () => ctx.workspaces.pickDirectory()
				})
			}, GitWorktreeCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map