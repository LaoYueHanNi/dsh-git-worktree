window.__ModuleLoader__.load({
	id: "@laoyuehanni/dsh-git-worktree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
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
		* Pre-flight check of a user-typed NEW branch name against git's ref-name
		* rules (git check-ref-format's reject list, the subset typing can hit):
		* non-empty; no leading `-` (git would parse it as a flag); no space, `~^:?*[\`
		* or control character; no `..`, `@{`, `//`, leading/trailing `/`; no component
		* starting with `.` or ending with `.lock`; no trailing `.`; not the lone `@`.
		* `git switch -c` stays the authority — a miss here surfaces through the
		* error envelope — this only feeds immediate form feedback.
		* @param name - raw draft text (NOT trimmed: a space is a real issue).
		* @returns the issue kind, or null when the name is acceptable.
		*/
		function branchNameIssue(name) {
			if (name.trim() === "") return "empty";
			if (name.startsWith("-")) return "leadingDash";
			if (name === "@") return "illegal";
			if (/[\s~^:?*[\\\u0000-\u001f]/.test(name)) return "illegal";
			if (name.includes("..") || name.includes("@{") || name.includes("//")) return "illegal";
			if (name.startsWith("/") || name.endsWith("/")) return "illegal";
			if (name.endsWith(".")) return "illegal";
			if (/(^|\/)\./.test(name)) return "illegal";
			if (/(^|\/)[^/]+\.lock($|\/)/.test(name)) return "illegal";
			return null;
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
		/** POST ROUTE_PREFIX/branch — create a NEW branch from the current checkout and switch to it. */
		const ROUTE_BRANCH = `${ROUTE_PREFIX}/branch`;
		/** POST ROUTE_PREFIX/fetch — sync remote-tracking refs (fetch every remote + prune). */
		const ROUTE_FETCH = `${ROUTE_PREFIX}/fetch`;
		/** POST ROUTE_PREFIX/update — fast-forward the current branch to its upstream. */
		const ROUTE_UPDATE = `${ROUTE_PREFIX}/update`;
		/** POST ROUTE_PREFIX/group — git belonging facts for a batch of workspace paths. */
		const ROUTE_GROUP = `${ROUTE_PREFIX}/group`;
		/** POST ROUTE_PREFIX/inspect — pre-delete facts for one worktree directory. */
		const ROUTE_INSPECT = `${ROUTE_PREFIX}/inspect`;
		/** POST ROUTE_PREFIX/remove — delete one linked worktree (git registration + folder). */
		const ROUTE_REMOVE = `${ROUTE_PREFIX}/remove`;
		/** POST ROUTE_PREFIX/exists — batch directory-existence probe (fs, no git). */
		const ROUTE_EXISTS = `${ROUTE_PREFIX}/exists`;
		/** POST ROUTE_PREFIX/ensure-directory — mkdir -p a missing worktree storage slot. */
		const ROUTE_ENSURE_DIRECTORY = `${ROUTE_PREFIX}/ensure-directory`;
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
		* Cut a NEW branch out of the current checkout and isolate it in a fresh
		* worktree (the current branch itself is occupied by the main worktree).
		* @param repoPath - absolute directory inside the repository.
		* @param branch - the current checkout's branch (or `HEAD` when detached).
		* @param name - explicit name for the new branch; omitted, the host
		* derives `<branch>-wt`, suffixing past taken names.
		*/
		function requestWorktreeCutout(repoPath, branch, name) {
			return post(ROUTE_WORKTREE, {
				repoPath,
				branch,
				cutout: true,
				...name === void 0 ? {} : { name }
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
		/**
		* Create a NEW branch from the directory's current checkout and switch to it
		* in place.
		* @param repoPath - absolute directory whose HEAD the branch is cut from.
		* @param name - user-typed new branch name (validated client-side already).
		*/
		function requestCreateBranch(repoPath, name) {
			return post(ROUTE_BRANCH, {
				repoPath,
				name
			});
		}
		/**
		* Sync remote-tracking refs (fetch every remote + prune) for the repository.
		* @param repoPath - absolute directory inside the repository.
		*/
		function requestFetch(repoPath) {
			return post(ROUTE_FETCH, { repoPath });
		}
		/**
		* Update the CURRENT checkout: fetch every remote, then fast-forward the
		* checked-out branch to its upstream.
		* @param repoPath - absolute directory whose checked-out branch is updated.
		*/
		function requestUpdate(repoPath) {
			return post(ROUTE_UPDATE, { repoPath });
		}
		/**
		* Git belonging facts for a batch of workspace directories; a path outside
		* any git repository answers null, a failed route call answers the error
		* envelope (the sidebar then renders flat, its degrade shape).
		* @param paths - absolute workspace directories to probe.
		*/
		async function requestGroupWorktrees(paths) {
			return post(ROUTE_GROUP, { paths });
		}
		/**
		* Pre-delete facts for one worktree directory: the uncommitted-file count
		* (lost with the folder) and the branch's ahead count (kept).
		* @param path - absolute worktree directory.
		*/
		function requestInspectWorktree(path) {
			return post(ROUTE_INSPECT, { path });
		}
		/**
		* Remove one linked worktree (git registration + folder). `force` rides
		* `--force` past uncommitted changes the confirm dialog already showed.
		* @param path - absolute worktree directory to delete.
		* @param force - delete past uncommitted changes.
		*/
		function requestRemoveWorktree(path, force) {
			return post(ROUTE_REMOVE, {
				path,
				force
			});
		}
		/**
		* Batch directory-existence probe (true = exists AND is a directory). The
		* sidebar gates register-as-workspace on this so a missing folder never
		* reaches the DSH workspace API.
		* @param paths - absolute directories to probe.
		*/
		function requestPathExists(paths) {
			return post(ROUTE_EXISTS, { paths });
		}
		/**
		* Recreate a missing worktree storage slot (`mkdir -p`). The host gates this
		* to paths directly inside the storage root; historical sessions reattach
		* automatically once the directory is back.
		* @param path - the missing slot directory (absolute).
		*/
		function requestEnsureDirectory(path) {
			return post(ROUTE_ENSURE_DIRECTORY, { path });
		}
		//#endregion
		//#region \0git-worktree-css:C:\Users\OYW\.dsh\gitworktree\dsh-worktree-origin-feature-0.1.2-alpha.3\src\client\BranchChip.module.css?inline
		const css$3 = "/* Branch chip row inside the composer tool row (conversation.input_1419641174.left_1419641174,\n * right of the mode chips). Modeled as a single rounded-rectangle\n * segmented control: the branch picker and the worktree toggle share one\n * container with a thin divider between them, so they read as one\n * affordance instead of two loose buttons.\n *\n * Geometry mirrors the composer trigger chips in the DSH base (see\n * PermissionSelect / ModelSelect): 28px height, 13/20 medium-secondary\n * label, transparent fill, no outline 鈥?the dock stays at the same\n * visual weight as the surrounding chips (dsh-worktree select, standard\n * mode select, Workspace Write, MiniMax-M3 High). The corners stop short\n * of the base's full pill (24px) so the silhouette stays a chip rather\n * than a capsule, per the design brief. */\n\n/* Shared trigger geometry 鈥?copied 1:1 from the base composer triggers\n * (PermissionSelect .trigger_1419641174 / ModelSelect .trigger_1419641174). Centralizing here\n * keeps the two segments visually fused so the divider reads as part of\n * one component, not two loose buttons. */\n.dock_1419641174 {\n  display: inline-flex;\n  align-items: stretch;\n  height: 28px;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  min-height: 28px;\n  overflow: hidden;\n}\n\n/* Vertical separator between the two segments. Uses the secondary label\n * color so it stays in the same tonal family as the surrounding trigger\n * outlines and chevrons. */\n.divider_1419641174 {\n  width: 1px;\n  margin: 6px 0;\n  background: color-mix(in srgb, currentColor 22%, transparent);\n  flex-shrink: 0;\n}\n\n.chip_1419641174 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 8px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.chip_1419641174:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The leftmost segment rounds only its left corners so it tucks into the dock. */\n.chip_1419641174:first-child {\n  border-top-left-radius: 6px;\n  border-bottom-left-radius: 6px;\n}\n\n/* Started sessions drop the worktree segment: the lone chip rounds all\n * corners and reads as a plain button, not a broken-off half control. */\n.chip_1419641174:only-child {\n  border-radius: 6px;\n}\n\n.branch_1419641174 {\n  max-width: 16em;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.check_1419641174,\n.checkOn_1419641174 {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 100%;\n  padding: 0 4px 0 8px;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n.check_1419641174:hover,\n.checkOn_1419641174:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The rightmost segment rounds only its right corners. */\n.check_1419641174:last-child,\n.checkOn_1419641174:last-child {\n  border-top-right-radius: 6px;\n  border-bottom-right-radius: 6px;\n}\n\n.box_1419641174 {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 14px;\n  height: 14px;\n  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);\n  border-radius: 4px;\n}\n\n/* Selected worktree: only the checkbox itself turns bluish and fills 鈥?the\n * surrounding button stays transparent so the label keeps the same\n * secondary tone. Mirrors the Claude Code toggle treatment. The inner\n * check rides the bluish fill with an inverted foreground token so the\n * glyph stays legible. */\n.checkOn_1419641174 .box_1419641174 {\n  border-color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  background: var(--dsw-alias-label-primary-bluish, #4186f0);\n  color: var(--dsw-alias-label-primary-foreground, #ffffff);\n}\n\n.checkLabel_1419641174 {\n  white-space: nowrap;\n}\n\n/* Confirm flyout: the second-level panel opening right of the branch\n * card (the base Menu's submenu posture: r12, inverted hairline,\n * shadow-lv3, --dsw-specific-menu). Width is content-driven — it follows\n * the longest line (for remote picks that is the subject line's branch\n * name) — floored at 168px (the Cancel/Confirm pair plus padding: short\n * branch names must not squeeze the buttons into wrapping \"切换中…\"\n * mid-word) and capped at 400px; BranchMenu also clamps it inline to the\n * room right of the card. Beyond the cap the lines wrap. border-box so\n * every width arm includes the card chrome. */\n.popCard_1419641174 {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1000;\n  width: max-content;\n  min-width: 168px;\n  max-width: min(400px, 80vw);\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.popAsk_1419641174 {\n  margin: 0;\n  padding: 6px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: inherit;\n  /* Branch names are long unbroken tokens — plain wrapping would let them\n   * overflow the capped card instead of breaking. */\n  overflow-wrap: anywhere;\n}\n\n/* Remote confirm's name line: the branch itself, weight 500 like the leaf\n * rows — the subject the ask line refers to (\"该远程分支\"). A dedicated\n * line keeps the long unbroken token away from the sentence, so wraps\n * happen inside the name instead of shredding the Chinese around it. */\n.popSubject_1419641174 {\n  margin: 0;\n  padding: 0 8px 2px;\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 500;\n  color: inherit;\n  overflow-wrap: anywhere;\n}\n\n.popActions_1419641174 {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type.\n * nowrap keeps labels like 切换中… from splitting mid-word when the flyout\n * is pinned to its minimum width by a short branch name. */\n.popActions_1419641174 button {\n  flex: 1 1 0;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.popActions_1419641174 button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.popActions_1419641174 button:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.popActions_1419641174 button:last-child {\n  color: var(--dsw-alias-label-primary-bluish, #4186f0);\n  font-weight: 500;\n}\n\n/* ── Branch picker popup (BranchMenu) ──────────────────────────────\n * Upward-opening card pinned above the chip, in the Menu's card chrome\n * (r12, inverted hairline, shadow-lv3, --dsw-specific-menu — same family\n * as .popCard_1419641174). Three owner requirements shape the geometry:\n *\n *   1. height cap: min(420px, 60vh) on the card, only the rows area\n *      scrolls (.menuRows_1419641174) — heading and search stay pinned;\n *   2. the search field sits pinned at the card's bottom edge, directly\n *      above the chip, with the scrolling rows above it;\n *   3. the card is CSS-`bottom`-pinned ~6px above the chip's top and so\n *      grows entirely upward — it can never cover the composer or fill\n *      the viewport, whatever the branch count.\n *\n * The inline `left`/`bottom` come from BranchMenu's placement pass; the\n * width is fixed here (design 360px — 320 tree + 40 tool strip — and\n * viewport-capped) so horizontal clamping stays deterministic without\n * measuring the card. */\n\n/* The portal lands directly under document.body_1419641174, outside the shell's\n * box-sizing reset — content-box default would add padding/border on top\n * of the declared width (360 became 370, and the width:100% children\n * padded 16px past the card's right clip, shearing off their rounded\n * corners). Every width-declared box in this popup opts back into\n * border-box: the card, the toolbar, the rows, and the search input. */\n.menuCard_1419641174 {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1000;\n  display: flex;\n  flex-direction: row;\n  width: min(360px, calc(100vw - 24px));\n  max-height: min(420px, 60vh);\n  overflow: hidden;\n  padding: 4px;\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  background: var(--dsw-specific-menu, var(--dsw-alias-surface-raised, #ffffff));\n  box-shadow: var(--dsw-shadow-lv3);\n}\n\n/* Left tool strip (IDEA branch-panel posture at popup scale): a narrow\n * column of icon-only buttons for actions that do not belong in the tree\n * — locate the checked-out branch, expand/collapse the whole tree.\n * Buttons stack from the BOTTOM up: the card's height shrinks when the\n * repo has few branches, so a top-anchored strip would drift around and\n * the buttons would sit far from the search bar; anchoring to the bottom\n * pins them at a stable spot (beside the search row) whatever the height. */\n.menuToolbar_1419641174 {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  justify-content: flex-end;\n  gap: 2px;\n  flex-shrink: 0;\n  width: 32px;\n  padding: 0 2px;\n  margin-right: 4px;\n  border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);\n}\n\n.menuToolButton_1419641174 {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  margin: 0 auto;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  cursor: pointer;\n}\n\n.menuToolButton_1419641174:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n.menuToolButton_1419641174:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n/* The sync tools while their action runs: a soft opacity pulse. The glyph\n * is a directional arrow, so the circular-refresh spin read as garbled\n * rotation — pulsing keeps the arrow legible while clearly \"live\", and the\n * button keeps full opacity (the usual disabled dim would read as broken\n * for an in-flight network operation). */\n.menuToolButtonRunning_1419641174 svg {\n  animation: menuToolPulse 700ms ease-in-out infinite alternate;\n}\n\n.menuToolButtonRunning_1419641174:disabled {\n  opacity: 1;\n  cursor: progress;\n}\n\n@keyframes menuToolPulse {\n  from { opacity: 1; }\n  to { opacity: 0.25; }\n}\n\n/* The main column: heading + scrollable rows + pinned search. */\n.menuMain_1419641174 {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n/* Non-interactive group heading — the Menu label row's posture. */\n.menuHeading_1419641174 {\n  padding: 6px 8px 4px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  flex-shrink: 0;\n}\n\n/* The only scrollable region: shrinks within the capped card so the\n * heading above and the search below stay visible while rows scroll. */\n.menuRows_1419641174 {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n}\n\n/* Menu-row-like buttons: transparent fill, hover tint, same 13px type.\n * Weight 500 mirrors the chip's branch label (the portal escapes the\n * composer's font context, so the match must be explicit — the inherited\n * body weight is 400 and reads visibly lighter than the chip beside it). */\n.menuRow_1419641174 {\n  box-sizing: border-box; /* width:100% + padding must stay inside .menuRows_1419641174 */\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 28px;\n  padding: 4px 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.menuRow_1419641174:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* Locked rows (a linked-worktree session answers every non-current pick\n * with the main-checkout toast): dimmed with a default cursor, but KEEP\n * the click path alive — no disabled attribute, the double-click is the\n * toast's stage. Hover stays quiet: nothing is on offer here. */\n.menuRowLocked_1419641174 {\n  opacity: 0.45;\n  cursor: default;\n}\n\n.menuRowLocked_1419641174:hover {\n  background: transparent;\n}\n\n/* The checked-out branch: a persistent tint a step above the resting rows\n * so it reads as \"you are here\" the moment the list scrolls it into view\n * (BranchMenu centers it on open) — the trailing check alone is easy to\n * miss from a distance. */\n.menuRowSelected_1419641174,\n.menuRowSelected_1419641174:hover:not(:disabled) {\n  background: color-mix(in srgb, currentColor 10%, transparent);\n}\n\n/* IDEA-style selection: the clicked row gets a bluish fill, layering over\n * the HEAD tint when the same row is both — selection communicates intent,\n * the HEAD tint communicates position, and they coexist (IDEA 4.4). */\n.menuRowPicked_1419641174,\n.menuRowPicked_1419641174:hover:not(:disabled) {\n  background: color-mix(in srgb, var(--dsw-alias-label-primary-bluish, #4186f0) 18%, transparent);\n}\n\n.menuRowLabel_1419641174 {\n  flex: 1 1 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Upstream divergence arrows (↑N/↓N) trailing a local branch row, before\n * the HEAD check: the count badge tone at a smaller size so a busy list\n * still reads the name first. Plain text arrows — no base-set icon pairs\n * a direction with a count. tabular-nums keeps ↑10 from nudging neighbors\n * as the digits tick. */\n.menuRowArrow_1419641174 {\n  flex-shrink: 0;\n  font-size: 11px;\n  line-height: 20px;\n  font-weight: 400;\n  font-variant-numeric: tabular-nums;\n  color: color-mix(in srgb, currentColor 55%, transparent);\n}\n\n/* Search hit highlight (IDEA): the matched substring gets a warm tint\n * behind it — theme-agnostic, legible in both light and dark cards. */\n.menuSearchMark_1419641174 {\n  background: color-mix(in srgb, #b58900 38%, transparent);\n  border-radius: 2px;\n}\n\n/* Tree group rows (folder headers) — BranchMenu's '/' prefix tree: the\n * same row geometry as .menuRow_1419641174, but labeled in the secondary tone so the\n * leaf rows pop, with a count badge and a chevron that turns on expand. */\n.menuGroup_1419641174 {\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  width: 100%;\n  min-height: 28px;\n  padding: 4px 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  font: inherit;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.menuGroup_1419641174:hover {\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* The two top-level section headers (local/remote branches) step ABOVE the\n * folder headers they contain: primary label tone like the leaf rows plus\n * a heavier weight, so the nav hierarchy reads group > row > folder — the\n * folder headers keep the secondary tone that alone would leave the\n * sections as the faintest (and most important) rows on the list. */\n.menuGroupTop_1419641174 {\n  color: inherit;\n  font-weight: 600;\n}\n\n.menuGroupLabel_1419641174 {\n  flex: 1 1 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.menuGroupChevron_1419641174 {\n  flex-shrink: 0;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 12px;\n  height: 12px;\n  transition: transform 120ms ease;\n}\n\n.menuGroupChevronOpen_1419641174 {\n  transform: rotate(90deg);\n}\n\n.menuGroupCount_1419641174 {\n  flex-shrink: 0;\n  font-size: 12px;\n  line-height: 20px;\n  font-weight: 400;\n  color: color-mix(in srgb, currentColor 55%, transparent);\n}\n\n/* Zero-search-hit state: centered secondary line inside the rows area. */\n.menuEmpty_1419641174 {\n  padding: 10px 8px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary, #81858c);\n  text-align: center;\n}\n\n/* Bottom-pinned search field, separated from the rows by a hairline.\n * Borderless so it reads as part of the card, focus shown as the\n * standard hover tint rather than an outline. */\n.menuSearchWrap_1419641174 {\n  flex-shrink: 0;\n  margin-top: 2px;\n  padding-top: 4px;\n  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);\n}\n\n.menuSearch_1419641174 {\n  box-sizing: border-box; /* width:100% + padding must stay inside the wrap */\n  width: 100%;\n  height: 30px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  /* Weight 500 mirrors the chip's branch label (see .menuRow_1419641174) — the portal\n   * escapes the composer's font context and would inherit body's 400. */\n  font-weight: 500;\n  line-height: 20px;\n}\n\n.menuSearch_1419641174::placeholder {\n  color: var(--dsw-alias-label-secondary, #81858c);\n}\n\n.menuSearch_1419641174:focus {\n  outline: none;\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n/* ── New-branch create flyout (BranchMenu toolbar plus) ─────────────\n * Opens to the RIGHT of the card (the confirm flyout's posture) and holds\n * the whole flow in one panel: ask line, naming input, live hint, and the\n * Cancel/Create pair — typing the name and pressing Create fires the\n * create in one stroke, no second confirm step. */\n\n/* The toolbar plus in its active (flyout open) state: a bluish tint\n * layering the same way the picked row does, so the toggled state reads at\n * a glance. */\n.menuToolButtonOn_1419641174,\n.menuToolButtonOn_1419641174:hover:not(:disabled) {\n  background: color-mix(in srgb, var(--dsw-alias-label-primary-bluish, #4186f0) 18%, transparent);\n  color: var(--dsw-alias-label-primary-bluish, #4186f0);\n}\n\n/* The naming input inside the flyout: borderless, part of the card, focus\n * shown as the standard hover tint. Fixed width — the popCard is\n * max-content, so a percentage width would chase the input's own default\n * size instead of the design width. */\n.menuCreate_1419641174 {\n  box-sizing: border-box;\n  width: 248px;\n  height: 30px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  /* Weight 500 mirrors the chip's branch label (see .menuSearch_1419641174). */\n  font-weight: 500;\n  line-height: 20px;\n}\n\n.menuCreate_1419641174::placeholder {\n  color: var(--dsw-alias-label-secondary, #81858c);\n}\n\n.menuCreate_1419641174:focus {\n  outline: none;\n  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));\n}\n\n.menuCreate_1419641174:disabled {\n  opacity: 0.5;\n}\n\n/* The error line under the input — only rendered while the draft is\n * unacceptable with a non-empty reason; the input itself stays neutral,\n * the line carries the state. */\n.menuCreateHintBad_1419641174 {\n  margin: 0;\n  padding: 0 8px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-error);\n}\n";
		const tagId$3 = "@laoyuehanni/dsh-git-worktree/BranchChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId$3 + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-git-worktree";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var BranchChip_module_default = {
			"input": "input_1419641174",
			"left": "left_1419641174",
			"trigger": "trigger_1419641174",
			"dock": "dock_1419641174",
			"divider": "divider_1419641174",
			"chip": "chip_1419641174",
			"branch": "branch_1419641174",
			"check": "check_1419641174",
			"checkOn": "checkOn_1419641174",
			"box": "box_1419641174",
			"checkLabel": "checkLabel_1419641174",
			"popCard": "popCard_1419641174",
			"popAsk": "popAsk_1419641174",
			"popSubject": "popSubject_1419641174",
			"popActions": "popActions_1419641174",
			"menuRows": "menuRows_1419641174",
			"body": "body_1419641174",
			"menuCard": "menuCard_1419641174",
			"menuToolbar": "menuToolbar_1419641174",
			"menuToolButton": "menuToolButton_1419641174",
			"menuToolButtonRunning": "menuToolButtonRunning_1419641174",
			"menuMain": "menuMain_1419641174",
			"menuHeading": "menuHeading_1419641174",
			"menuRow": "menuRow_1419641174",
			"menuRowLocked": "menuRowLocked_1419641174",
			"menuRowSelected": "menuRowSelected_1419641174",
			"menuRowPicked": "menuRowPicked_1419641174",
			"menuRowLabel": "menuRowLabel_1419641174",
			"menuRowArrow": "menuRowArrow_1419641174",
			"menuSearchMark": "menuSearchMark_1419641174",
			"menuGroup": "menuGroup_1419641174",
			"menuGroupTop": "menuGroupTop_1419641174",
			"menuGroupLabel": "menuGroupLabel_1419641174",
			"menuGroupChevron": "menuGroupChevron_1419641174",
			"menuGroupChevronOpen": "menuGroupChevronOpen_1419641174",
			"menuGroupCount": "menuGroupCount_1419641174",
			"menuEmpty": "menuEmpty_1419641174",
			"menuSearchWrap": "menuSearchWrap_1419641174",
			"menuSearch": "menuSearch_1419641174",
			"menuToolButtonOn": "menuToolButtonOn_1419641174",
			"menuCreate": "menuCreate_1419641174",
			"menuCreateHintBad": "menuCreateHintBad_1419641174"
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
		* on the left (locate-current + expand/collapse-all + new-branch), then a
		* main column of heading / tree / search. The list renders in TWO
		* top-level collapsible groups — local branches first, then remote
		* branches (each a folder-header-style row with chevron + count): under a
		* SINGLE remote the remote rows drop their `<remote>/` prefix (the header
		* already says "remote"; a stripped display name can never collide with a
		* local row because the host hides remote branches that have a local
		* twin), with SEVERAL remotes the full names stay so `origin`/`upstream`
		* become the folder layer beneath the header. Picking a remote row hands
		* the owner the real `<remote>/name` (see pick) — the remote confirms are
		* the owner's wording (tracking-twin switch / twin-in-worktree).
		* Selection model borrowed from
		* IDEA: a single click SELECTS a row (blue); double-click or Enter then OPENS the
		* right-side confirm flyout for that row — the switch itself always goes
		* through the confirmation step, never straight away. While the confirm
		* flyout is open, clicking another row re-anchors it (the old one-click
		* pick flow).
		*
		* The new-branch tool (the toolbar's plus) opens the create flyout to the
		* RIGHT of the card (the confirm flyout's submenu posture): the flyout
		* holds the naming input — validated as you type (git ref-name rules plus
		* a duplicate check against the rows) with a live hint naming the issue
		* or, while the draft is acceptable, the branch the cut starts from — and
		* the Cancel/Create pair. Confirming fires the create in ONE stroke
		* (create AND in-place switch; no second confirm step — typing the name
		* into the flyout and pressing Create IS the intent). While the create
		* runs the flyout freezes (busy disables input and buttons); a failure
		* toasts and leaves the flyout open for a renamed retry.
		* The confirm flyout is a second-level portal opening to the RIGHT of the
		* branch card (the base Menu's submenu posture): the chip sits in the
		* bottom composer, so the old below-the-chip bubble landed off-viewport.
		* The flyout is a separate portal (not clipped by the card's
		* overflow:hidden), horizontally anchored to the card's right edge — it
		* can never overlap the branch list — and vertically centered on the
		* picked row. Its width is content-driven, capped in CSS, wrapping.
		*
		* Close semantics: outside pointerdown (card, flyouts, and chip excluded)
		* cancels the confirm and closes the menu; Escape unwinds tier by tier —
		* confirm, then the create flyout, then search text, then selection, then
		* the menu; Enter in the search field commits the first enabled visible row.
		*
		* Long names and many branches: a clipped label shows the full name on
		* hover via the native title (gated to actually-clipped rows only). The
		* list ALWAYS renders as a full-depth '/' prefix tree: folder-header rows
		* (chevron + count) toggle; under an expanded folder, child rows show only
		* their own segment (indentation carries the hierarchy — no repeated path,
		* no color distinction); linear chains compress into one row. TREE_MIN_ROWS
		* only sets the DEFAULT opening depth: past it, just the checked-out
		* branch's chain starts open (centering still lands it mid-viewport); at
		* or under it, every folder starts open — few branches have nothing to hide.
		*/
		/**
		* The fetch/update glyph in IDEA's posture: a diagonal running from the
		* top-right down to a bottom-left arrowhead. `dashed` marks the metadata
		* move (fetch touches remote-tracking refs only, never working-tree
		* content); the solid variant is the in-place branch update (fetch +
		* fast-forward) — the pairing is IDEA's dashed/solid synchronize/update
		* language. The base library has no such glyph, so both are drawn here,
		* local to the menu; the sync spin animation targets `svg` descendants of
		* the tool button and applies to them unchanged.
		*/
		function FetchGlyph({ size = 16, dashed = true }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M13 3 L5.9 10.1",
					stroke: "currentColor",
					strokeWidth: "1.3",
					strokeLinecap: "round",
					strokeDasharray: dashed ? "2.4 1.6" : void 0
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5 5.9 V11 H10.1",
					stroke: "currentColor",
					strokeWidth: "1.3",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
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
		/** Past this many rows the tree starts with ONLY the checked-out branch's
		* chain open; at or under it every folder starts open (few branches have
		* nothing to hide). The tree itself always renders — this threshold is
		* about the default opening depth, never about flat vs tree. */
		const TREE_MIN_ROWS = 8;
		/** Leaf rows indent one chevron slot PAST their tree depth. Folder headers
		* lead with a collapsing chevron (12px icon + 6px gap) that leaf rows lack
		* — without compensation a leaf's text starts LEFT of its own group header's
		* text and same-level leaves read shallower than folders. The extra 18px
		* aligns same-level leaf TEXT with folder TEXT (the VS Code file-tree
		* posture: a chevron column marks foldable rows, a text column carries
		* content), so leaf padding is 8 + 12×depth + 18. */
		const LEAF_CHEVRON_SLOT = 18;
		/** Every folder path that renders a header, walking the tree depth-first. */
		function collectFolderPaths(nodes, out = []) {
			for (const node of nodes) if (node.children.length > 0) {
				out.push(node.path);
				collectFolderPaths(node.children, out);
			}
			return out;
		}
		const segCmp = (a, b) => a.localeCompare(b, void 0, {
			numeric: true,
			sensitivity: "base"
		});
		/** Split rows into the three groups and derive the remote display names. */
		function groupRows(rows) {
			const localRows = [];
			const remoteRows = [];
			const worktreeRows = [];
			for (const row of rows) if (row.kind === "remote") remoteRows.push(row);
			else if (row.kind === "worktree") worktreeRows.push(row);
			else localRows.push(row);
			const first = remoteRows[0]?.name ?? "";
			const slash = first.indexOf("/");
			const soleRemote = slash > 0 && remoteRows.every((row) => row.name.startsWith(first.slice(0, slash + 1))) ? first.slice(0, slash) : void 0;
			const display = (name) => soleRemote === void 0 ? name : name.slice(soleRemote.length + 1);
			return {
				localRows,
				remoteDisplayRows: remoteRows.map((row) => ({
					...row,
					name: display(row.name)
				})),
				worktreeRows,
				remoteNameMap: new Map(remoteRows.map((row) => [display(row.name), row.name]))
			};
		}
		/** Expanded-key space: folder paths carry their group prefix so a local
		* folder can never share a toggle state with a same-named remote display
		* folder (`feat/x` on both sides). Group OPEN flags stay booleans beside
		* this set — they are not part of the path namespace at all. */
		const groupKey = (group, path) => `${group}:${path}`;
		/** Build the prefix tree of the rows (see TreeNode). */
		function buildTree(rows) {
			const root = [];
			const find = (level, segment) => level.find((n) => n.segment === segment);
			for (const row of rows) {
				const segs = row.name.split("/").filter((s) => s !== "");
				let level = root;
				let path = "";
				for (let i = 0; i < segs.length; i += 1) {
					const seg = segs[i];
					if (seg === void 0) break;
					path = path === "" ? seg : `${path}/${seg}`;
					let node = find(level, seg);
					if (node === void 0) {
						node = {
							segment: seg,
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
				const seg = segs[i];
				if (seg === void 0) break;
				path = path === "" ? seg : `${path}/${seg}`;
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
		function BranchMenu({ open, anchorRef, rows, currentBranch, confirm, onSelect, canCreate, canAdopt, onCreate, busy, onFetch, fetchBusy, onUpdate, updateBusy, onClose, t }) {
			const cardRef = (0, react.useRef)(null);
			const inputRef = (0, react.useRef)(null);
			/**
			* Search-field ref callback: focus the field the moment it mounts. The
			* card mounts in two stages (open flips, then pos resolves a render
			* later), so an [open]-keyed passive effect fires while the input is
			* still unmounted — its focus() no-ops against a null ref. Focusing at
			* mount time is immune to that race by construction.
			*/
			/**
			* Search-field ref callback: focus the field the moment it mounts. The
			* card mounts in two stages (open flips, then pos resolves a render
			* later), so an [open]-keyed passive effect fires while the input is
			* still unmounted — its focus() no-ops against a null ref. Focusing at
			* mount time is immune to that race by construction. The callback MUST
			* be referentially stable: a fresh closure per render makes React
			* detach and re-attach it on every commit, and the re-attach runs
			* focus() again — each re-render (a click selection, a status refresh,
			* a sessions push) would yank focus back to the field, flickering its
			* focus tint. Stable identity = attach happens only at mount.
			*/
			const holdSearchFocus = (0, react.useCallback)((el) => {
				inputRef.current = el;
				if (el !== null) el.focus();
			}, []);
			/** Same mount-time focus trick for the new-branch input: the form mounts
			* when the toolbar plus flips `creating`, mid-card-lifecycle, so the ref
			* callback is the only reliable focus point. Stable for the same reason
			* as holdSearchFocus — typing would otherwise re-focus on every render. */
			const holdCreateFocus = (0, react.useCallback)((el) => {
				if (el !== null) el.focus();
			}, []);
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
			/** Expanded folder set, keyed by group-prefixed node path (see groupKey).
			* Re-seeded on every open so the current branch's chain is visible
			* without re-expanding by hand. */
			const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
			/** Top-level group open flags, beside the expanded set (which owns
			* folder paths only — a group header is not a path node). Re-seeded on
			* every open: past TREE_MIN_ROWS the remote group starts closed so the
			* list leads with the local branches. The WORKTREE group starts open
			* unconditionally — it is the blank session's quick-hop entry, always
			* worth its few rows. */
			const [localGroupOpen, setLocalGroupOpen] = (0, react.useState)(true);
			const [remoteGroupOpen, setRemoteGroupOpen] = (0, react.useState)(true);
			const [worktreeGroupOpen, setWorktreeGroupOpen] = (0, react.useState)(true);
			/** IDEA-style selection: clicked row (blue). Zero or one at a time. */
			const [selected, setSelected] = (0, react.useState)(null);
			/** The create flyout: open flag plus the live draft. Opening the menu
			* (or closing the flyout) resets both — see the open-reset effect. */
			const [creating, setCreating] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)("");
			/** The create flyout element and its placed position (see its place
			* pass below; same measure-then-place posture as the confirm flyout). */
			const createFlyRef = (0, react.useRef)(null);
			const [createFlyPos, setCreateFlyPos] = (0, react.useState)(null);
			const confirmRef = (0, react.useRef)(confirm);
			confirmRef.current = confirm;
			const queryRef = (0, react.useRef)(query);
			queryRef.current = query;
			const selectedRef = (0, react.useRef)(selected);
			selectedRef.current = selected;
			/** Fresh creating flag for the stale-safe document keydown listener. */
			const creatingRef = (0, react.useRef)(creating);
			creatingRef.current = creating;
			/** Latest rows for the open-reset effect: the effect must NOT re-run when
			* a mid-open refresh swaps the rows (that would reset folders the user
			* has toggled), but the reset itself still needs the freshest list. */
			const latestRows = (0, react.useRef)(rows);
			latestRows.current = rows;
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
			* keyboard Enter on a selected row — funnel through here. A remote row
			* carries its DISPLAY name through selection and anchors; the owner
			* always receives the real `<remote>/name` action name. */
			const pick = (el, name) => {
				if (el !== null) pendingRef.current = {
					name,
					el
				};
				setPendingName(name);
				onSelect(remoteNameMapRef.current.get(name) ?? name);
			};
			pickRef.current = pick;
			/** The two-group model of the rows (see groupRows) and each group's '/'
			* prefix tree — always on; TREE_MIN_ROWS only sets the default opening
			* depth (see the open-reset effect). */
			const grouped = (0, react.useMemo)(() => groupRows(rows), [rows]);
			const localTree = (0, react.useMemo)(() => buildTree(grouped.localRows), [grouped.localRows]);
			const remoteTree = (0, react.useMemo)(() => buildTree(grouped.remoteDisplayRows), [grouped.remoteDisplayRows]);
			/** Fresh display→action map for the stale-safe document keydown listener
			* (its Enter path funnels through pick, which reads the ref). */
			const remoteNameMapRef = (0, react.useRef)(grouped.remoteNameMap);
			remoteNameMapRef.current = grouped.remoteNameMap;
			/** Every folder key that renders a header — the expand/collapse-all
			* button's scope (group-prefixed, see groupKey). */
			const folderPaths = (0, react.useMemo)(() => [...collectFolderPaths(localTree).map((p) => groupKey("local", p)), ...collectFolderPaths(remoteTree).map((p) => groupKey("remote", p))], [localTree, remoteTree]);
			/** Locked row names (dimmed, pick-answered-with-hint) — a Set for the
			* click gate. MUST sit before the `!open` early return: a hook after it
			* would change the hook count between a closed and an open menu
			* (React #310, seen live as the whole dock unmounting on first open). */
			const lockedRows = (0, react.useMemo)(() => new Set(rows.filter((r) => r.locked === true).map((r) => r.name)), [rows]);
			const allExpanded = folderPaths.every((p) => expanded.has(p)) && localGroupOpen && remoteGroupOpen && (!canAdopt || worktreeGroupOpen);
			const toggleAll = () => {
				const next = !allExpanded;
				setLocalGroupOpen(next);
				setRemoteGroupOpen(next);
				setWorktreeGroupOpen(next);
				setExpanded(next ? new Set(folderPaths) : /* @__PURE__ */ new Set());
			};
			const locateCurrent = () => {
				setLocalGroupOpen(true);
				if (grouped.worktreeRows.some((row) => row.name === currentBranch)) setWorktreeGroupOpen(true);
				setExpanded((prev) => {
					const next = new Set(prev);
					for (const p of chainExpanded(currentBranch)) next.add(groupKey("local", p));
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
				setCreating(false);
				setDraft("");
				const currentRows = latestRows.current;
				const current = groupRows(currentRows);
				const localPaths = collectFolderPaths(buildTree(current.localRows)).map((p) => groupKey("local", p));
				const remotePaths = collectFolderPaths(buildTree(current.remoteDisplayRows)).map((p) => groupKey("remote", p));
				const many = currentRows.length > TREE_MIN_ROWS;
				setLocalGroupOpen(true);
				setRemoteGroupOpen(!many);
				setWorktreeGroupOpen(true);
				setExpanded(many ? new Set([...chainExpanded(currentBranch)].map((p) => groupKey("local", p))) : /* @__PURE__ */ new Set([...localPaths, ...remotePaths]));
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
			(0, react.useLayoutEffect)(() => {
				if (!creating) {
					setCreateFlyPos(null);
					return;
				}
				const place = () => {
					const fly = createFlyRef.current;
					const card = cardRef.current;
					if (fly === null || card === null) return;
					const cr = card.getBoundingClientRect();
					const vw = window.innerWidth;
					const vh = window.innerHeight;
					const left = cr.right + GAP;
					const room = Math.min(FLY_MAX_WIDTH, Math.max(200, vw - MARGIN - left));
					fly.style.maxWidth = `${room}px`;
					const fw = fly.offsetWidth;
					const fh = fly.offsetHeight;
					const top = Math.min(Math.max(cr.top + cr.height / 2 - fh / 2, MARGIN), Math.max(MARGIN, vh - fh - MARGIN));
					setCreateFlyPos({
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
			}, [creating]);
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
					if (createFlyRef.current?.contains(event.target) === true) return;
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
						if (creatingRef.current) {
							setCreating(false);
							setDraft("");
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
					const inputs = card.querySelectorAll("input");
					if (inputs.length > 0 && [...inputs].includes(active)) return;
					const leaves = [...card.querySelectorAll("button[role=\"menuitem\"][data-branch]")];
					if (key === "ArrowDown" || key === "ArrowUp") {
						event.preventDefault();
						if (leaves.length === 0) return;
						const idx = leaves.findIndex((b) => (b.dataset.branch ?? "") === selectedRef.current);
						let next = idx;
						if (key === "ArrowDown") next = idx < 0 ? 0 : Math.min(leaves.length - 1, idx + 1);
						else next = idx <= 0 ? leaves.length - 1 : idx - 1;
						const target = leaves[next];
						if (target === void 0) return;
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
			const visible = needle === "" ? rows : [
				...grouped.localRows,
				...grouped.worktreeRows,
				...grouped.remoteDisplayRows
			].filter((row) => row.name.toLowerCase().includes(needle));
			/** Enter in the search field: commit the first visible row (its rendered
			* button is the anchor — found by its data-branch key; the label text
			* alone can't identify a row inside a tree). */
			const commitFirst = () => {
				const first = visible[0];
				if (first === void 0) return;
				const card = cardRef.current;
				if (card === null) return;
				const el = card.querySelector(`button[data-branch="${CSS.escape(first.name)}"]`);
				pick(el, first.name);
			};
			/** New-branch draft validation: git ref-name rules first, then a duplicate
			* check against every EXISTING local branch — local rows and worktree
			* rows alike (a worktree row IS a checked-out branch, just filed under
			* its own group). A remote display name is not a claim on a new local
			* branch's name (its twin could not even coexist with one; the host
			* hides such remote rows). */
			const createIssue = branchNameIssue(draft);
			const existsLocally = (name) => grouped.localRows.some((row) => row.name === name) || grouped.worktreeRows.some((row) => row.name === name);
			const createDuplicate = createIssue === null && existsLocally(draft);
			const createValid = createIssue === null && !createDuplicate;
			/** Error line under the input, ONLY while the draft is unacceptable with
			* a non-empty reason (the ask line above already names the cut point, and
			* an untouched input needs no error) — the Create button disables in
			* lockstep. */
			const createHint = createDuplicate ? t("menuNewBranchExists") : t("menuNewBranchBad");
			const showCreateHint = createIssue !== null && createIssue !== "empty" || createDuplicate;
			/** Fire the create in one stroke — the flyout's whole point. Invalid
			* drafts and a running create are no-ops (the Create button disables in
			* lockstep); the owner closes the menu on success, toasts on failure and
			* leaves the flyout open for a renamed retry. */
			const commitCreate = () => {
				if (!createValid || busy) return;
				onCreate(draft);
			};
			/** Row class composition: base + HEAD tint + selection (selection wins)
			* + the locked dim. (`css` is an index-signature record, so noUncheckedIndexedAccess
			* types every class as possibly absent — the base falls back to ''.) */
			const rowClass = (row, name) => {
				let cls = BranchChip_module_default.menuRow ?? "";
				if (name === currentBranch) cls += ` ${BranchChip_module_default.menuRowSelected}`;
				if (name === selected) cls += ` ${BranchChip_module_default.menuRowPicked}`;
				if (row?.locked === true) cls += ` ${BranchChip_module_default.menuRowLocked}`;
				return cls;
			};
			/** Locked rows keep the click path ALIVE (the owner answers picks with
			* the main-checkout toast) but stay unselected — a dimmed row wearing
			* the blue selection would read as "chosen yet unusable". */
			const isLocked = (name) => lockedRows.has(name);
			/** The upstream divergence arrows of a local row (IDEA's ↑N/↓N) ahead of
			* the trailing check: plain text marks in the secondary tone — no base
			* icon pairs a direction with a count. Absent without an upstream or
			* when in sync. */
			const renderArrows = (row) => {
				if (row === null) return null;
				const marks = [];
				if ((row.ahead ?? 0) > 0) marks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: BranchChip_module_default.menuRowArrow,
					title: t("aheadTitle", { n: row.ahead }),
					children: ["↑", row.ahead]
				}, "ahead"));
				if ((row.behind ?? 0) > 0) marks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: BranchChip_module_default.menuRowArrow,
					title: t("behindTitle", { n: row.behind }),
					children: ["↓", row.behind]
				}, "behind"));
				return marks;
			};
			/** A row's click behavior: with the confirm flyout open, clicking a row
			* re-picks it (the old one-click flow — the flyout re-anchors); without
			* one it just selects (IDEA model — double-click or Enter opens the
			* confirm flyout for the selected row). Locked rows do neither: dimmed
			* rows are not selectable, the double-click is the hint's stage. `el` is
			* nullable like {@link pick}'s anchor: a row whose button is already
			* unmounted still selects/picks, it just re-anchors nothing. */
			const rowClick = (el, name) => {
				if (isLocked(name)) return;
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
			/** One top-level group header (local/remote branches): the folder-header
			* posture with its own open flag — toggling flips the flag, never a key
			* in the expanded path set. `menuGroupTop` lifts the tone above the
			* folder headers (see the CSS note). In the search view (onToggle
			* absent) it renders inert: the matched subtrees below are force-open
			* anyway. */
			const renderGroupHeader = (label, count, open, onToggle) => {
				const cls = `${BranchChip_module_default.menuGroup} ${BranchChip_module_default.menuGroupTop}`;
				return onToggle === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: cls,
					role: "presentation",
					style: { paddingLeft: 8 },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
							size: 12,
							className: BranchChip_module_default.menuGroupChevron
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.menuGroupLabel,
							children: label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: BranchChip_module_default.menuGroupCount,
							children: [
								"(",
								count,
								")"
							]
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: cls,
					"aria-expanded": open,
					onClick: () => {
						if (guardActive()) return;
						onToggle();
						armShiftGuard();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
							size: 12,
							className: open ? `${BranchChip_module_default.menuGroupChevron} ${BranchChip_module_default.menuGroupChevronOpen}` : BranchChip_module_default.menuGroupChevron
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BranchChip_module_default.menuGroupLabel,
							children: label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: BranchChip_module_default.menuGroupCount,
							children: [
								"(",
								count,
								")"
							]
						})
					]
				});
			};
			/**
			* One tree group-header row: its own segment (a compressed chain's
			* walked segments join the label), a count badge, and a chevron that
			* turns for expansion. Clicking toggles. One color throughout — the
			* folder path is not color-distinguished from the name. `prefix` scopes
			* the expanded-key space to the owning group (see groupKey) and keeps
			* React keys unique across the two trees.
			*/
			const renderHeader = (node, label, depth, prefix) => {
				const isOpen = expanded.has(`${prefix}${node.path}`);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: BranchChip_module_default.menuGroup,
					"data-group": node.path,
					style: { paddingLeft: 8 + depth * 12 },
					"aria-expanded": isOpen,
					onClick: () => {
						if (guardActive()) return;
						toggle(`${prefix}${node.path}`);
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
				}, `${prefix}group:${node.path}`);
			};
			/** One tree leaf row: under an expanded folder it shows only its own
			* segment (indentation carries the hierarchy — no repeated full path);
			* a compressed linear chain keeps its walked segments in the label so
			* the context survives without a pointless one-entry folder. The
			* data-branch key stays the group-local DISPLAY name — unique across
			* all groups (a remote display name can never equal a local row; a
			* worktree row's branch has left the local group) — which is what the
			* buttonOf/commitFirst/center lookups rely on. */
			const renderLeaf = (node, label, depth, prefix) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitem",
				"data-branch": node.path,
				"data-kind": node.leaf?.kind,
				className: rowClass(node.leaf ?? null, node.path),
				title: node.leaf?.locked === true ? t("mainRepoOnly") : void 0,
				style: { paddingLeft: 8 + depth * 12 + LEAF_CHEVRON_SLOT },
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
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: BranchChip_module_default.menuRowLabel,
						children: label
					}),
					renderArrows(node.leaf),
					node.path === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })
				]
			}, `${prefix}${node.path}`);
			/** One flat worktree row: a direct hop target, one per linked worktree
			* — no tree (worktree names rarely fork, and the group is a launcher,
			* not a taxonomy), no confirm (the double-click IS the hop; the owner
			* picks it up through onSelect). The native title carries the worktree
			* DIRECTORY — the fact a branch row cannot show. The row the session
			* currently lives in keeps the trailing check + HEAD tint: it is the
			* "you are here" mark the local group no longer holds (its branch was
			* filed into THIS group). */
			const renderFlatLeaf = (row, prefix) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitem",
				"data-branch": row.name,
				"data-kind": row.kind,
				className: rowClass(row, row.name),
				title: row.locked === true ? t("mainRepoOnly") : row.path,
				style: { paddingLeft: 38 },
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
					children: row.name
				}), row.name === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })]
			}, `${prefix}${row.name}`);
			/** Recursive tree renderer. Linear chains — nodes that are neither a
			* branch nor a real fork — compress into the next row's label, so
			* `feature/优化` stays a single flat row instead of a pointless one-entry
			* folder, while a real fork (`a/deep/tree` holding leaf1+leaf2) gets a
			* header whose children show only their own segments. */
			const renderTree = (nodes, depth, prefix) => {
				const out = [];
				for (const node of nodes) {
					let cur = node;
					const parts = [];
					while (cur.leaf === null && cur.children.length === 1) {
						const next = cur.children[0];
						if (next === void 0) break;
						parts.push(cur.segment);
						cur = next;
					}
					const label = parts.length === 0 ? cur.segment : `${parts.join("/")}/${cur.segment}`;
					if (cur.leaf !== null) {
						out.push(renderLeaf(cur, label, depth, prefix));
						if (cur.children.length > 0) {
							out.push(renderHeader(cur, label, depth, prefix));
							if (expanded.has(`${prefix}${cur.path}`)) out.push(...renderTree(cur.children, depth + 1, prefix));
						}
					} else {
						out.push(renderHeader(cur, label, depth, prefix));
						if (expanded.has(`${prefix}${cur.path}`)) out.push(...renderTree(cur.children, depth + 1, prefix));
					}
				}
				return out;
			};
			/** Search view: keep matching leaves AND their ancestor folders (IDEA's
			* filter keeps the path), hide non-matching siblings, force every kept
			* folder open, and highlight the hit substring. No chain compression —
			* the full ancestor path is exactly the context the search is for. */
			/** Needle-matching leaf count of a tree: the search-view group header
			* must count the MATCHES under it, not the whole group — a full count
			* above two filtered rows reads as a lie. */
			const searchLeafCount = (nodes) => nodes.reduce((sum, node) => sum + (node.leaf !== null && node.leaf.name.toLowerCase().includes(needle) ? 1 : 0) + searchLeafCount(node.children), 0);
			const renderSearch = (nodes, depth, prefix) => {
				const out = [];
				for (const node of nodes) {
					const leafHit = node.leaf !== null && node.leaf.name.toLowerCase().includes(needle);
					const childHit = subtreeMatches(node.children);
					if (leafHit) out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						role: "menuitem",
						"data-branch": node.path,
						"data-kind": node.leaf?.kind,
						className: rowClass(node.leaf ?? null, node.path),
						title: node.leaf?.locked === true ? t("mainRepoOnly") : void 0,
						style: { paddingLeft: 8 + depth * 12 + LEAF_CHEVRON_SLOT },
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
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BranchChip_module_default.menuRowLabel,
								children: renderLabel(node.segment)
							}),
							renderArrows(node.leaf),
							node.path === currentBranch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })
						]
					}, `${prefix}${node.path}`));
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
						}, `${prefix}search:${node.path}`));
						out.push(...renderSearch(node.children, depth + 1, prefix));
					}
				}
				return out;
			};
			/** The rendered button for a branch name (flyout anchor on click-select
			* paths, where the handler only has the name at hand). */
			const buttonOf = (name) => cardRef.current?.querySelector(`button[data-branch="${CSS.escape(name)}"]`) ?? null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: cardRef,
					className: BranchChip_module_default.menuCard,
					style: {
						left: pos.left,
						bottom: pos.bottom
					},
					role: "menu",
					"aria-label": t("menuBranches"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BranchChip_module_default.menuToolbar,
						role: "toolbar",
						"aria-label": t("menuBranches"),
						children: [
							canCreate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: creating ? `${BranchChip_module_default.menuToolButton} ${BranchChip_module_default.menuToolButtonOn}` : BranchChip_module_default.menuToolButton,
								title: t("menuNewBranch"),
								"aria-label": t("menuNewBranch"),
								"aria-pressed": creating,
								onClick: () => {
									confirmRef.current?.onCancel();
									const next = !creating;
									setCreating(next);
									if (!next) setDraft("");
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 16 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: BranchChip_module_default.menuToolButton,
								title: t("menuLocate"),
								"aria-label": t("menuLocate"),
								onClick: locateCurrent,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGoalOutline16, { size: 16 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: updateBusy ? `${BranchChip_module_default.menuToolButton} ${BranchChip_module_default.menuToolButtonRunning}` : BranchChip_module_default.menuToolButton,
								title: t("menuUpdate"),
								"aria-label": t("menuUpdate"),
								disabled: busy || fetchBusy,
								onClick: () => {
									confirmRef.current?.onCancel();
									onUpdate();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FetchGlyph, { dashed: false })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: fetchBusy ? `${BranchChip_module_default.menuToolButton} ${BranchChip_module_default.menuToolButtonRunning}` : BranchChip_module_default.menuToolButton,
								title: t("menuFetch"),
								"aria-label": t("menuFetch"),
								disabled: busy || updateBusy,
								onClick: () => {
									confirmRef.current?.onCancel();
									onFetch();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FetchGlyph, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: BranchChip_module_default.menuToolButton,
								title: allExpanded ? t("menuCollapseAll") : t("menuExpandAll"),
								"aria-label": allExpanded ? t("menuCollapseAll") : t("menuExpandAll"),
								disabled: rows.length === 0,
								onClick: toggleAll,
								children: allExpanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutline14, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { size: 14 })
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BranchChip_module_default.menuMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: BranchChip_module_default.menuHeading,
								children: t("menuBranches")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: BranchChip_module_default.menuRows,
								role: "presentation",
								ref: holdRowsCenter,
								children: [needle === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									grouped.localRows.length > 0 && renderGroupHeader(t("menuLocalBranches"), grouped.localRows.length, localGroupOpen, () => setLocalGroupOpen((value) => !value)),
									localGroupOpen && renderTree(localTree, 1, "local:"),
									canAdopt && grouped.worktreeRows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHeader(t("menuWorktrees"), grouped.worktreeRows.length, worktreeGroupOpen, () => setWorktreeGroupOpen((value) => !value)), worktreeGroupOpen && grouped.worktreeRows.map((row) => renderFlatLeaf(row, "worktree:"))] }),
									grouped.remoteDisplayRows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHeader(t("menuRemoteBranches"), grouped.remoteDisplayRows.length, remoteGroupOpen, () => setRemoteGroupOpen((value) => !value)), remoteGroupOpen && renderTree(remoteTree, 1, "remote:")] })
								] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									grouped.localRows.some((row) => row.name.toLowerCase().includes(needle)) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHeader(t("menuLocalBranches"), searchLeafCount(localTree), true), renderSearch(localTree, 1, "local:")] }),
									canAdopt && grouped.worktreeRows.some((row) => row.name.toLowerCase().includes(needle)) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHeader(t("menuWorktrees"), grouped.worktreeRows.filter((row) => row.name.toLowerCase().includes(needle)).length, true), grouped.worktreeRows.filter((row) => row.name.toLowerCase().includes(needle)).map((row) => renderFlatLeaf(row, "worktree:"))] }),
									grouped.remoteDisplayRows.some((row) => row.name.toLowerCase().includes(needle)) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHeader(t("menuRemoteBranches"), searchLeafCount(remoteTree), true), renderSearch(remoteTree, 1, "remote:")] })
								] }), visible.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: BranchChip_module_default.menuEmpty,
									children: rows.length === 0 ? t("menuNoBranches") : t("menuNoMatches")
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
				}), document.body),
				confirm !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: flyRef,
					className: BranchChip_module_default.popCard,
					style: flyPos ?? FLY_MEASURE,
					role: "dialog",
					"aria-label": confirm.ask,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BranchChip_module_default.popAsk,
							children: confirm.ask
						}),
						confirm.subject !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BranchChip_module_default.popSubject,
							children: confirm.subject
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						})
					]
				}), document.body),
				creating && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: createFlyRef,
					className: BranchChip_module_default.popCard,
					style: createFlyPos ?? FLY_MEASURE,
					role: "dialog",
					"aria-label": t("createBranchTitle", { branch: currentBranch }),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BranchChip_module_default.popAsk,
							children: t("createBranchTitle", { branch: currentBranch })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: holdCreateFocus,
							className: BranchChip_module_default.menuCreate,
							type: "text",
							value: draft,
							placeholder: t("menuNewBranchPlaceholder"),
							"aria-label": t("menuNewBranchPlaceholder"),
							"aria-invalid": createIssue !== null && createIssue !== "empty",
							spellCheck: false,
							disabled: busy,
							onChange: (event) => {
								setDraft(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commitCreate();
								}
							}
						}),
						showCreateHint && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BranchChip_module_default.menuCreateHintBad,
							role: "status",
							children: createHint
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BranchChip_module_default.popActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: busy,
								onClick: () => {
									setCreating(false);
									setDraft("");
								},
								children: t("actionCancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !createValid || busy,
								onClick: commitCreate,
								children: busy ? t("createBranchBusy") : t("actionConfirm")
							})]
						})
					]
				}), document.body)
			] });
		}
		//#endregion
		//#region src/client/BranchChip.tsx
		/**
		* BranchChipDock: the composer tool-row entry (conversation.input.left, right
		* of the mode chips) for sessions inside a git repository. Blank sessions
		* OF THE MAIN checkout get the full segmented control — branch picker plus
		* the worktree isolation toggle — because that is the moment to choose the
		* environment for the conversation, and starting a worktree is a main-repo
		* decision. Once the session starts, the worktree toggle is withdrawn (its
		* directory is fixed). A session inside a LINKED worktree scopes the whole
		* entry down: blank, the menu lists every branch for READING but every
		* pick but the current branch answers with the main-checkout hint (and
		* neither the toggle nor the in-place new-branch tool exists there);
		* started, the menu shows nothing but the session's own branch — fetch and
		* update-current stay, since neither moves the checkout (probeRepo still
		* roots at the session directory's toplevel, never the main checkout).
		* Non-git directories and load failures render nothing. The confirm
		* dialogs and the error toast live here too.
		*
		* Checking the worktree toggle pops the cutout confirm dialog right away:
		* confirming it cuts a NEW branch (`<current>-wt`, suffixes past taken
		* names) out of the current checkout into a fresh isolated worktree — the
		* current branch itself is occupied by the main worktree, so git refuses a
		* second worktree on it. The dialog stands alone above the chip (the
		* branch menu stays closed); the chip still opens the menu, where picking
		* another branch keeps the plain create-or-reuse flow and re-picking the
		* current branch stages the same cutout confirm. Dismissing the dialog and
		* sending the message anyway means the user knowingly stays in the current
		* directory — no separate notice fires on send.
		*
		* In-place branch creation (the menu toolbar's plus, worktree mode off)
		* opens the create flyout right of the branch card: type the name, press
		* Create — the new branch is cut from the session directory's current
		* checkout and checked out there in one stroke, the worktree-less sibling
		* of the cutout flow. A failure toasts and leaves the flyout open.
		*
		* Remote branches join the picker under their own menu group: picking one
		* stages the remote-twin confirm — the switch creates the local tracking
		* branch in place (git's dwim), the worktree pick creates the twin inside
		* its fresh worktree. Both rides go through the existing /switch and
		* /worktree routes, which already resolve `<remote>/name` display names.
		*
		* Branches held by linked worktrees get their own 「工作树」 group (blank
		* sessions only): they have left the local group — git refuses to check
		* them out twice, so a local-group row would be a dead end — and a
		* double-click hops the session straight into that worktree directory
		* (adoptWorktree; no git action, no confirm). A started session's
		* directory is fixed, so the group only exists while blank.
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
		/** First free `<base>-wt` name against the local branch list — the prefilled
		* draft of the cutout dialog (same shape as the host's suffix walk, minus
		* the storage-folder probe the client cannot see). */
		function firstFreeCutoutName(base, taken) {
			const stem = `${base}-wt`;
			if (!taken.includes(stem)) return stem;
			for (let i = 2;; i += 1) {
				const candidate = `${stem}${i}`;
				if (!taken.includes(candidate)) return candidate;
			}
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
		/** Viewport edge clearance and chip gap, mirroring BranchMenu's posture. */
		const POP_MARGIN = 12;
		const POP_GAP = 6;
		/** Unplaced dialog: hidden but laid out at a fixed origin so offsetWidth is
		* real for the measure-then-place pass (BranchMenu's flyout trick). */
		const POP_MEASURE = {
			left: "-9999px",
			bottom: "0px",
			visibility: "hidden"
		};
		/**
		* Clamp a branch name for chip display: names up to 25 chars pass through;
		* longer ones show the first 24 chars plus an ellipsis.
		* @param branch - full branch name.
		*/
		function displayBranch(branch) {
			return branch.length <= BRANCH_DISPLAY_MAX ? branch : `${branch.slice(0, 24)}…`;
		}
		/**
		* Build the branch rows for the picker in three kinds: LOCAL branches not
		* held by a linked worktree, REMOTE branches, and one WORKTREE row per
		* linked worktree. A branch held by a worktree LEAVES the local group —
		* git refuses to check it out twice, so the row would be a dead end; the
		* worktree group is the way INTO it instead (a direct session hop, see
		* the owner's onAdoptWorktree). The main worktree and detached worktrees
		* don't come along: the main checkout is home, not a hop target, and a
		* detached worktree has no branch name to offer.
		*
		* Inside a linked-worktree session every row but the current branch is
		* LOCKED (dimmed, still clickable): a pick reaches the owner, which
		* answers with the main-checkout hint — the dimming reads as "not usable
		* here" at a glance while the click keeps its explanation.
		*/
		function buildBranchRows(branches, worktrees, currentBranch, inLinkedWorktree) {
			const held = new Set(worktrees.flatMap((w) => w.main || w.branch === void 0 ? [] : [w.branch]));
			const lock = (name) => inLinkedWorktree && name !== currentBranch;
			return [
				...branches.filter((b) => b.kind === "local" && !held.has(b.name)).map((b) => ({
					name: b.name,
					kind: "local",
					...b.ahead === void 0 ? {} : { ahead: b.ahead },
					...b.behind === void 0 ? {} : { behind: b.behind },
					locked: lock(b.name)
				})),
				...branches.filter((b) => b.kind === "remote").map((b) => ({
					name: b.name,
					kind: "remote",
					locked: lock(b.name)
				})),
				...worktrees.flatMap((w) => w.main || w.branch === void 0 ? [] : [{
					name: w.branch,
					kind: "worktree",
					path: w.path,
					locked: lock(w.branch)
				}])
			];
		}
		/**
		* The check-time confirm dialog, rendered while the branch menu is closed:
		* the same popCard chrome as BranchMenu's flyout, but bottom-pinned above
		* the chip in the menu card's posture — the flyout's right-of-card anchor
		* has no card to sit beside here. Outside pointerdown and Escape cancel;
		* the naming input (cutout flow) takes focus when present, else the
		* confirm button does so Enter commits.
		*/
		function ChipConfirm({ anchorRef, ask, subject, confirmLabel, cancelLabel, busy, draft, onDraftChange, draftPlaceholder, draftInvalid, draftHint, onConfirm, onCancel }) {
			const popRef = (0, react.useRef)(null);
			const confirmRef = (0, react.useRef)(null);
			const draftInputRef = (0, react.useRef)(null);
			const [pos, setPos] = (0, react.useState)(null);
			(0, react.useLayoutEffect)(() => {
				const place = () => {
					const anchor = anchorRef.current;
					const pop = popRef.current;
					if (anchor === null || pop === null) return;
					const rect = anchor.getBoundingClientRect();
					const vw = window.innerWidth;
					const vh = window.innerHeight;
					const left = Math.min(Math.max(rect.left, POP_MARGIN), Math.max(POP_MARGIN, vw - POP_MARGIN - pop.offsetWidth));
					setPos({
						left,
						bottom: vh - rect.top + POP_GAP
					});
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [anchorRef]);
			(0, react.useEffect)(() => {
				const raf = requestAnimationFrame(() => {
					(draftInputRef.current ?? confirmRef.current)?.focus();
				});
				return () => {
					cancelAnimationFrame(raf);
				};
			}, []);
			(0, react.useEffect)(() => {
				const onPointerDown = (event) => {
					if (popRef.current?.contains(event.target) === true) return;
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
			}, [onCancel, anchorRef]);
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: popRef,
				className: BranchChip_module_default.popCard,
				style: pos ?? POP_MEASURE,
				role: "dialog",
				"aria-label": ask,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BranchChip_module_default.popAsk,
						children: ask
					}),
					subject !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BranchChip_module_default.popSubject,
						children: subject
					}),
					onDraftChange !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: draftInputRef,
						className: BranchChip_module_default.menuCreate,
						type: "text",
						value: draft,
						placeholder: draftPlaceholder,
						"aria-label": draftPlaceholder,
						"aria-invalid": draftInvalid,
						spellCheck: false,
						disabled: busy,
						onChange: (event) => {
							onDraftChange(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" && draftInvalid !== true && !busy) {
								event.preventDefault();
								onConfirm();
							}
						}
					}), draftInvalid === true && draftHint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BranchChip_module_default.menuCreateHintBad,
						role: "status",
						children: draftHint
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BranchChip_module_default.popActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							onClick: onCancel,
							children: cancelLabel
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							ref: confirmRef,
							type: "button",
							disabled: busy || draftInvalid === true,
							onClick: onConfirm,
							children: confirmLabel
						})]
					})
				]
			}), document.body);
		}
		/** The tool-row entry registered into conversation.input.left. */
		function BranchChipDock({ session, adoptWorktree, sessionsList, t }) {
			const sessionId = session?.sessionId;
			const cwd = (0, react.useSyncExternalStore)(sessionsList.subscribe, () => sessionId === void 0 ? void 0 : sessionsList.getSnapshot().byId[sessionId])?.cwd;
			const [repo, refresh] = useRepoStatus(cwd);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [worktreeMode, setWorktreeMode] = (0, react.useState)(false);
			const [confirm, setConfirm] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			/** Which arrow is spinning: fetch and update are single-flight against
			* the SAME busyRef (mutually exclusive), but the spinning state must be
			* per-tool — one shared flag made both arrows rotate at once. */
			const [fetchBusy, setFetchBusy] = (0, react.useState)(false);
			const [updateBusy, setUpdateBusy] = (0, react.useState)(false);
			const [toast, setToast] = (0, react.useState)(null);
			const chipRef = (0, react.useRef)(null);
			const busyRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				setWorktreeMode(false);
				setConfirm(null);
				setMenuOpen(false);
			}, [cwd]);
			(0, react.useEffect)(() => {
				if (!session.blank) {
					setWorktreeMode(false);
					setConfirm((current) => current !== null && current.kind !== "switch" ? null : current);
				}
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
			/** Create-branch flow: POST /branch (create from the current checkout and
			* switch to it in place), then refetch the status — the menu closed by
			* then, and the chip label must name the new branch. Fired directly by
			* the menu's create flyout (no confirm kind): typing the name into the
			* flyout and pressing Create is the intent. */
			const doCreateBranch = (0, react.useCallback)((name) => runGuarded(async () => {
				if (cwd === void 0) return "no session directory";
				const result = await requestCreateBranch(cwd, name);
				if (!result.ok) return result.error;
				await refresh();
			}), [
				cwd,
				refresh,
				runGuarded
			]);
			/** Remote-sync flow: POST /fetch (fetch every remote + prune), then
			* refetch the status. Deliberately NOT runGuarded: its success closes the
			* menu, while the whole point of a sync is watching the refreshed branch
			* list in place. Single-flight shares busyRef with the other actions, so
			* a sync and a confirm action can never interleave. A network fetch has
			* NO visible side effect when the remote moved not — the spinning tool
			* (menu side) and the done toast here ARE the feedback. */
			const doFetch = (0, react.useCallback)(async () => {
				if (busyRef.current) return;
				busyRef.current = true;
				setBusy(true);
				setFetchBusy(true);
				const failure = await (async () => {
					if (cwd === void 0) return "no session directory";
					const result = await requestFetch(cwd);
					if (!result.ok) return result.error;
				})();
				busyRef.current = false;
				setBusy(false);
				setFetchBusy(false);
				if (failure !== void 0) {
					showError(failure);
					return;
				}
				await refresh();
				setToast({
					seq: Date.now(),
					text: t("fetchDone")
				});
			}, [
				cwd,
				refresh,
				showError,
				t
			]);
			/** Update-current-branch flow: POST /update (fetch every remote, then
			* fast-forward the checked-out branch to its upstream), then refetch the
			* status in place — same keep-the-menu-open semantics as the fetch sync.
			* The toast tells the two apart: fast-forwarded vs already up to date. */
			const doUpdate = (0, react.useCallback)(async () => {
				if (busyRef.current) return;
				busyRef.current = true;
				setBusy(true);
				setUpdateBusy(true);
				const result = cwd === void 0 ? void 0 : await requestUpdate(cwd);
				busyRef.current = false;
				setBusy(false);
				setUpdateBusy(false);
				if (result === void 0) {
					showError("no session directory");
					return;
				}
				if (!result.ok) {
					showError(result.error);
					return;
				}
				await refresh();
				setToast({
					seq: Date.now(),
					text: result.updated ? t("updateDone", { branch: result.branch }) : t("updateUpToDate")
				});
			}, [
				cwd,
				refresh,
				showError,
				t
			]);
			/** Worktree-group flow: hop the session into the EXISTING worktree
			* directory. No git action, no confirm — the double-click IS the hop
			* (a directory jump is reversible and touches nothing), and the owner's
			* adoptWorktree registers the folder and opens a blank session there. */
			const doAdoptWorktree = (0, react.useCallback)((path) => {
				if (busyRef.current) return;
				busyRef.current = true;
				setBusy(true);
				adoptWorktree(path).then(() => {
					setMenuOpen(false);
				}).catch((cause) => {
					showError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					busyRef.current = false;
					setBusy(false);
				});
			}, [adoptWorktree, showError]);
			/** Worktree flow: POST /worktree (create-or-reuse, or cut out a new
			* branch under an explicit name), register the directory, hop sessions. */
			const doWorktree = (0, react.useCallback)((branch, cutout, name) => runGuarded(async () => {
				if (cwd === void 0) return "no session directory";
				const result = cutout ? await requestWorktreeCutout(cwd, branch, name) : await requestWorktree(cwd, branch);
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
			const inLinkedWorktree = facts !== null && facts.worktrees.find((w) => w.main)?.path !== facts.repoRoot;
			const rows = (0, react.useMemo)(() => {
				if (facts === null) return [];
				if (inLinkedWorktree && !session.blank) {
					const current = facts.branches.find((b) => b.kind === "local" && b.name === facts.currentBranch);
					return current === void 0 ? [] : [{
						name: current.name,
						kind: "local",
						...current.ahead === void 0 ? {} : { ahead: current.ahead },
						...current.behind === void 0 ? {} : { behind: current.behind }
					}];
				}
				return buildBranchRows(facts.branches, facts.worktrees, facts.currentBranch, inLinkedWorktree);
			}, [
				facts,
				inLinkedWorktree,
				session.blank
			]);
			const localNames = (0, react.useMemo)(() => rows.filter((row) => row.kind !== "remote").map((row) => row.name), [rows]);
			if (facts === null) return null;
			const confirmLocalName = confirm === null ? "" : localBranchName(confirm.branch);
			const isCutout = confirm?.kind === "worktree-cutout";
			const cutoutDraft = isCutout ? confirm.draft ?? "" : "";
			const cutoutIssue = isCutout ? branchNameIssue(cutoutDraft) : null;
			const cutoutDuplicate = isCutout && cutoutIssue === null && localNames.includes(cutoutDraft);
			const cutoutValid = cutoutIssue === null && !cutoutDuplicate;
			const cutoutHint = cutoutDuplicate ? t("menuNewBranchExists") : cutoutIssue !== null && cutoutIssue !== "empty" ? t("menuNewBranchBad") : void 0;
			const existingWorktree = confirm === null || confirm.kind !== "worktree" ? void 0 : facts.worktrees.find((w) => w.branch === confirmLocalName);
			/** One confirm bundle shared by the menu flyout and the standalone
			* dialog (whichever is showing). Remote picks keep the ask line SHORT (a
			* wrapping sentence with long branch names breaks badly) and name the
			* branch on its own weight-500 line — the dwim/worktree consequences are
			* git's default behavior, not worth a third line. */
			const confirmBundle = confirm === null ? null : {
				ask: confirm.kind === "worktree-cutout" ? t("worktreeAskCutOut", { branch: confirmLocalName }) : confirm.kind === "worktree" ? confirm.remote === true ? t("worktreeAskRemote") : t(existingWorktree !== void 0 ? "worktreeAskReuse" : "worktreeAskNew", { branch: confirmLocalName }) : confirm.remote === true ? t("switchAskRemote") : t("switchAsk", { branch: confirm.branch }),
				...confirm.remote === true ? { subject: confirm.branch } : {},
				confirmLabel: busy ? confirm.kind === "worktree" || confirm.kind === "worktree-cutout" ? t("worktreeBusy") : t("switchBusy") : t("actionConfirm"),
				cancelLabel: t("actionCancel"),
				busy,
				onConfirm: () => {
					if (confirm.kind === "worktree" || confirm.kind === "worktree-cutout") {
						if (confirm.kind === "worktree-cutout" && !cutoutValid) return;
						doWorktree(confirm.branch, confirm.kind === "worktree-cutout", confirm.draft);
					} else doSwitch(confirm.branch);
				},
				onCancel: () => {
					if (!busy) setConfirm(null);
				}
			};
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
					}), session.blank && !inLinkedWorktree && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: BranchChip_module_default.divider,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: worktreeMode ? BranchChip_module_default.checkOn : BranchChip_module_default.check,
						onClick: () => {
							const next = !worktreeMode;
							setWorktreeMode(next);
							setMenuOpen(false);
							if (next) {
								setConfirm({
									kind: "worktree-cutout",
									branch: facts.currentBranch,
									draft: firstFreeCutoutName(localBranchName(facts.currentBranch), localNames)
								});
								if (!busyRef.current) refresh();
							} else setConfirm(null);
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
					confirm: confirmBundle,
					canCreate: !worktreeMode && !inLinkedWorktree,
					canAdopt: session.blank,
					busy,
					onCreate: (name) => {
						doCreateBranch(name);
					},
					onFetch: () => {
						doFetch();
					},
					fetchBusy,
					onUpdate: () => {
						doUpdate();
					},
					updateBusy,
					onSelect: (branch) => {
						if (branch === facts.currentBranch) {
							if (worktreeMode) setConfirm({
								kind: "worktree-cutout",
								branch,
								draft: firstFreeCutoutName(localBranchName(branch), localNames)
							});
							else setMenuOpen(false);
							return;
						}
						if (inLinkedWorktree) {
							setToast({
								seq: Date.now(),
								text: t("mainRepoOnly")
							});
							return;
						}
						const row = rows.find((r) => r.name === branch);
						if (row?.kind === "worktree" && row.path !== void 0) {
							doAdoptWorktree(row.path);
							return;
						}
						const remote = row?.kind === "remote";
						setConfirm({
							kind: worktreeMode ? "worktree" : "switch",
							branch,
							remote
						});
					},
					onClose: () => {
						setMenuOpen(false);
					},
					t
				}),
				confirmBundle !== null && !menuOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChipConfirm, {
					anchorRef: chipRef,
					...confirmBundle,
					...isCutout ? { draft: cutoutDraft } : {},
					...isCutout ? { onDraftChange: (value) => {
						setConfirm((current) => current?.kind === "worktree-cutout" ? {
							...current,
							draft: value
						} : current);
					} } : {},
					draftPlaceholder: t("menuNewBranchPlaceholder"),
					...isCutout && !cutoutValid ? { draftInvalid: true } : {},
					...cutoutHint === void 0 ? {} : { draftHint: cutoutHint }
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
		* root field is staged only when the user touched it, so a save writes a
		* sparse patch and never restates fields it did not see. The grouping switch
		* is not staged: a set optimistic-publishes, yields a frame so the spinner
		* can paint, then writes; pending holds until the seat callback settles.
		*/
		var CardForm = class {
			scope;
			afterGroupSidebarWrite;
			snapshotValue;
			listeners = /* @__PURE__ */ new Set();
			draft;
			saving = false;
			failed = false;
			groupingPending = false;
			groupingDraft;
			/**
			* @param scope - the bound settings scope for the `git-worktree` namespace.
			* @param afterGroupSidebarWrite - awaited after the setting lands, until
			*   the sidebar seat has actually swapped (facts in on enable, native
			*   paint on disable). Absent in unit tests that only cover the write.
			*/
			constructor(scope, afterGroupSidebarWrite) {
				this.scope = scope;
				this.afterGroupSidebarWrite = afterGroupSidebarWrite;
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
			/** @returns the edit, clear, save, discard, and grouping-switch actions bound to this form. */
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
					},
					setGroupSidebar: (value) => this.setGroupSidebar(value)
				};
			}
			/**
			* Flip the grouping switch immediately, then persist.
			*
			* `scope.set` only stores the document; the visible sidebar swap (inject
			* + `/group` facts, or dispose + native paint) happens after. Pending
			* stays up until that callback settles so the spinner matches what the
			* user sees, not the write round-trip.
			*/
			async setGroupSidebar(value) {
				if (this.groupingPending) return;
				if (value === this.effectiveGroupSidebar()) return;
				this.groupingPending = true;
				this.groupingDraft = value;
				this.publish();
				await yieldForPaint();
				try {
					await this.scope.set("groupSidebar", value);
					if (this.afterGroupSidebarWrite !== void 0) await this.afterGroupSidebarWrite(value);
				} finally {
					this.groupingPending = false;
					this.groupingDraft = void 0;
					this.publish();
				}
			}
			/** Resolved grouping switch, preferring an in-flight optimistic draft. */
			effectiveGroupSidebar() {
				return this.groupingDraft ?? this.scope.getSnapshot().value?.groupSidebar ?? true;
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
					failed: this.failed,
					groupSidebar: this.effectiveGroupSidebar(),
					groupingPending: this.groupingPending
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
		/** Yield until after the next paint (rAF), or a macrotask when rAF is absent (tests). */
		function yieldForPaint() {
			return new Promise((resolve) => {
				if (typeof requestAnimationFrame === "function") {
					requestAnimationFrame(() => {
						resolve();
					});
					return;
				}
				setTimeout(resolve, 0);
			});
		}
		//#endregion
		//#region \0git-worktree-css:C:\Users\OYW\.dsh\gitworktree\dsh-worktree-origin-feature-0.1.2-alpha.3\src\client\GitWorktreeCard.module.css?inline
		const css$2 = "/* git-worktree settings card on the Plugins configuration tab. Visual\n * language mirrors the settings section's own card chrome (border radius,\n * layer fills, pending badge, footer buttons) so cards from different\n * packages sit in one list without reading as two designs; tokens only, no\n * literal colors. */\n\n.card_1870175511 {\n  list-style: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 12px;\n  background: var(--dsw-alias-bg-layer-3);\n  transition: border-color .16s, background .16s;\n}\n\n.card_1870175511:hover {\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n/* An open card reads as the one being worked on, not merely taller. */\n.cardOpen_1870175511 {\n  background: var(--dsw-alias-bg-layer-2);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n.header_1870175511 {\n  width: 100%;\n  appearance: none;\n  border: 0;\n  background: none;\n  font: inherit;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 14px 16px;\n  border-radius: 12px;\n}\n\n.header_1870175511:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: -2px;\n}\n\n/* Name over description, mirroring the section's own plugin cards: the\n * description is what tells one plugin's settings from another's. */\n.headText_1870175511 {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.name_1870175511 {\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 1.4;\n  color: var(--dsw-alias-label-primary);\n}\n\n.description_1870175511 {\n  font-size: 13px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Carried on the header so a collapsed card still says it holds edits. */\n.pending_1870175511 {\n  flex: none;\n  border-radius: 999px;\n  padding: 1px 8px;\n  font-size: 11px;\n  line-height: 17px;\n  font-weight: 500;\n  white-space: nowrap;\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.chevron_1870175511 {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n  transition: transform .16s;\n}\n\n.chevronOpen_1870175511 {\n  transform: rotate(180deg);\n}\n\n.body_1870175511 {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  margin: 0 16px;\n  padding: 12px 0 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.note_1870175511 {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.field_1870175511 {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.fieldLabel_1870175511 {\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.input_1870175511 {\n  box-sizing: border-box;\n  width: 100%;\n  padding: 4px 8px;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-bg-layer-2);\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  appearance: none;\n}\n\n.input_1870175511:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: -1px;\n}\n\n.input_1870175511:disabled {\n  opacity: 0.6;\n}\n\n/* The directory control and its native-dialog launcher share one row. */\n.inputRow_1870175511 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.inputRow_1870175511 .input_1870175511 {\n  flex: 1;\n  min-width: 0;\n}\n\n.browse_1870175511 {\n  appearance: none;\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 4px 10px;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary);\n  background: none;\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.browse_1870175511:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n.browse_1870175511:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n.browse_1870175511:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n.hint_1870175511 {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.footer_1870175511 {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 8px 0 4px;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n}\n\n.failed_1870175511 {\n  flex: 1;\n  min-width: 0;\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-error);\n}\n\n.discard_1870175511,\n.save_1870175511 {\n  appearance: none;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  padding: 5px 14px;\n  font: inherit;\n  font-size: 13px;\n  line-height: 1.5;\n  cursor: pointer;\n}\n\n.discard_1870175511 {\n  border-color: var(--dsw-alias-border-l2);\n  background: none;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.discard_1870175511:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n\n.save_1870175511 {\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-bg-layer-3);\n}\n\n.discard_1870175511:disabled,\n.save_1870175511:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n.discard_1870175511:focus-visible,\n.save_1870175511:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n/* Sidebar-grouping switch: title + hint + caution beside a checkbox. */\n.toggleRow_1870175511 {\n  margin-top: 10px;\n  flex-direction: row;\n  align-items: flex-start;\n  gap: 10px;\n}\n\n.toggleText_1870175511 {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.toggleLabel_1870175511 {\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n.toggleMark_1870175511 {\n  margin-left: 4px;\n  font-weight: 400;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.toggleHint_1870175511 {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.toggleNote_1870175511 {\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.toggleControl_1870175511 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex: none;\n  margin-top: 2px;\n}\n\n.spinner_1870175511 {\n  display: flex;\n  color: var(--dsw-alias-label-tertiary);\n  animation: spin 0.7s linear infinite;\n}\n\n@keyframes spin {\n  to { transform: rotate(360deg); }\n}\n\n.toggle_1870175511 {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--dsw-alias-brand-primary);\n  cursor: pointer;\n}\n\n.toggle_1870175511:disabled {\n  cursor: progress;\n}\n";
		const tagId$2 = "@laoyuehanni/dsh-git-worktree/GitWorktreeCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId$2 + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-git-worktree";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var GitWorktreeCard_module_default = {
			"card": "card_1870175511",
			"cardOpen": "cardOpen_1870175511",
			"header": "header_1870175511",
			"headText": "headText_1870175511",
			"name": "name_1870175511",
			"description": "description_1870175511",
			"pending": "pending_1870175511",
			"chevron": "chevron_1870175511",
			"chevronOpen": "chevronOpen_1870175511",
			"body": "body_1870175511",
			"note": "note_1870175511",
			"field": "field_1870175511",
			"fieldLabel": "fieldLabel_1870175511",
			"input": "input_1870175511",
			"inputRow": "inputRow_1870175511",
			"browse": "browse_1870175511",
			"hint": "hint_1870175511",
			"footer": "footer_1870175511",
			"failed": "failed_1870175511",
			"discard": "discard_1870175511",
			"save": "save_1870175511",
			"toggleRow": "toggleRow_1870175511",
			"toggleText": "toggleText_1870175511",
			"toggleLabel": "toggleLabel_1870175511",
			"toggleMark": "toggleMark_1870175511",
			"toggleHint": "toggleHint_1870175511",
			"toggleNote": "toggleNote_1870175511",
			"toggleControl": "toggleControl_1870175511",
			"spinner": "spinner_1870175511",
			"toggle": "toggle_1870175511"
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: `${GitWorktreeCard_module_default.field} ${GitWorktreeCard_module_default.toggleRow}`,
							"aria-busy": state.groupingPending,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: GitWorktreeCard_module_default.toggleText,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: GitWorktreeCard_module_default.toggleLabel,
										children: [t("cardGroupSidebarLabel"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: GitWorktreeCard_module_default.toggleMark,
											children: t("cardGroupSidebarMark")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: GitWorktreeCard_module_default.toggleHint,
										children: t("cardGroupSidebarHint")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: GitWorktreeCard_module_default.toggleNote,
										children: t("cardGroupSidebarNote")
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: GitWorktreeCard_module_default.toggleControl,
								children: [state.groupingPending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitWorktreeCard_module_default.spinner,
									role: "status",
									"aria-label": t("cardGroupSidebarBusy"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLoadingOutline16, { size: 14 })
								}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: GitWorktreeCard_module_default.toggle,
									type: "checkbox",
									disabled: lockInput || state.groupingPending,
									checked: state.groupSidebar,
									onChange: (event) => {
										props.setGroupSidebar(event.target.checked);
									}
								})]
							})]
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
		//#region src/client/sidebar-groups.ts
		/**
		* Derive the sidebar groups.
		*
		* Rules (the shipped design): git facts absent/null → plain single row;
		* same-`repoRoot` workspaces cluster into one repo group; inside a group the
		* main worktree leads and linked members keep registry order; a repo cluster
		* with exactly ONE member degrades to a plain row (zero visual intrusion for
		* repositories without worktrees); a group renders where its FIRST member
		* sits in the registry order (the main worktree's slot).
		* @param items - workspace list items in registry order.
		* @param facts - per-path git facts from the /group route (absent = unknown).
		* @returns groups in render order.
		*/
		function deriveSidebarGroups(items, facts) {
			const bucketOrder = [];
			const buckets = /* @__PURE__ */ new Map();
			const singles = [];
			items.forEach((workspace, index) => {
				const pathFacts = facts?.[workspace.path];
				if (pathFacts === void 0 || pathFacts === null) {
					singles.push({
						index,
						group: singleGroup(workspace)
					});
					return;
				}
				const bucketKey = `repo:${pathFacts.repoRoot}`;
				let bucket = buckets.get(bucketKey);
				if (bucket === void 0) {
					bucket = {
						index,
						mainSeen: false,
						members: []
					};
					buckets.set(bucketKey, bucket);
					bucketOrder.push(bucketKey);
				}
				bucket.members.push({
					workspace,
					label: pathFacts.main ? {
						type: "main",
						branch: pathFacts.branch
					} : {
						type: "linked",
						branch: pathFacts.branch
					}
				});
				if (pathFacts.main) bucket.mainSeen = true;
			});
			const repoGroups = /* @__PURE__ */ new Map();
			for (const key of bucketOrder) {
				const bucket = buckets.get(key);
				if (bucket === void 0) continue;
				const ordered = bucket.mainSeen ? [...bucket.members].sort((a, b) => Number(b.label.type === "main") - Number(a.label.type === "main")) : bucket.members;
				const first = ordered[0];
				if (first === void 0) continue;
				const repoName = facts?.[first.workspace.path]?.repoName ?? first.workspace.title;
				if (ordered.length === 1) {
					singles.push({
						index: bucket.index,
						group: singleGroup(first.workspace)
					});
					continue;
				}
				repoGroups.set(key, {
					key,
					kind: "repo",
					repoName,
					members: ordered
				});
			}
			const slots = [...singles, ...[...repoGroups.values()].map((group) => {
				return {
					index: buckets.get(group.key)?.index ?? Number.MAX_SAFE_INTEGER,
					group
				};
			})];
			slots.sort((a, b) => a.index - b.index);
			return slots.map((slot) => slot.group);
		}
		/** A plain single-row group for one workspace. */
		function singleGroup(workspace) {
			return {
				key: `ws:${workspace.workspaceId}`,
				kind: "single",
				repoName: void 0,
				members: [{
					workspace,
					label: { type: "plain" }
				}]
			};
		}
		/**
		* Session ids a member row shows, in the workspace's stored order — the
		* native browser's visibility rule: archived hidden everywhere, subagent
		* rows never listed, and a blank row visible only while it IS the current
		* selection (a blank is the provisional New Session row).
		* @param workspace - the member's workspace.
		* @param sessions - session list snapshot.
		* @param archivedSessionIds - registry-global archive set.
		* @returns visible session ids in stored order.
		*/
		function visibleSessionIds(workspace, sessions, archivedSessionIds) {
			const archived = new Set(archivedSessionIds);
			const visible = [];
			for (const sessionId of workspace.sessionIds) {
				const summary = sessions.byId[sessionId];
				if (summary === void 0) continue;
				if (summary.origin === "subagent") continue;
				if (archived.has(sessionId)) continue;
				if (summary.blank && sessionId !== sessions.current) continue;
				visible.push(sessionId);
			}
			return visible;
		}
		/** localStorage key of the sidebar expansion map (browser-local only). */
		const EXPAND_STORAGE_KEY = "dsh-git-worktree.sidebar.expand";
		/** Read the persisted expansion map; unreadable/absent answers {}. */
		function loadExpandState() {
			if (typeof localStorage === "undefined") return {};
			try {
				const raw = localStorage.getItem(EXPAND_STORAGE_KEY);
				if (raw === null) return {};
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
				const out = {};
				for (const [key, value] of Object.entries(parsed)) if (typeof value === "boolean") out[key] = value;
				return out;
			} catch {
				return {};
			}
		}
		/** Persist the expansion map; write failures (quota, privacy mode) stay silent. */
		function saveExpandState(state) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify(state));
			} catch {}
		}
		/** localStorage key of grouping/order prefs (browser-local; P3 may graduate to store v5). */
		const VIEW_STORAGE_KEY = "dsh-git-worktree.sidebar.view";
		const DEFAULT_VIEW_PREFS = {
			groupBy: "workspace",
			orderBy: "updated"
		};
		/** Read persisted view prefs; unreadable/absent answers native defaults. */
		function loadViewPrefs() {
			if (typeof localStorage === "undefined") return DEFAULT_VIEW_PREFS;
			try {
				const raw = localStorage.getItem(VIEW_STORAGE_KEY);
				if (raw === null) return DEFAULT_VIEW_PREFS;
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_VIEW_PREFS;
				const record = parsed;
				return {
					groupBy: record.groupBy === "flat" || record.groupBy === "workspace" ? record.groupBy : DEFAULT_VIEW_PREFS.groupBy,
					orderBy: record.orderBy === "manual" || record.orderBy === "updated" ? record.orderBy : DEFAULT_VIEW_PREFS.orderBy
				};
			} catch {
				return DEFAULT_VIEW_PREFS;
			}
		}
		/** Persist view prefs; write failures stay silent. */
		function saveViewPrefs(prefs) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(prefs));
			} catch {}
		}
		/** Recency comparator: newest first, id as the deterministic tiebreak. */
		function byRecency(a, b) {
			if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
			return a.id < b.id ? -1 : 1;
		}
		/**
		* Index running/total subagent descendants under each ancestor reached through
		* an uninterrupted subagent-origin chain (ordinary forks terminate propagation).
		* Mirrors `indexSubagentDescendants` without importing the runtime bundle.
		*/
		function indexSubagentRunning(byId) {
			const out = /* @__PURE__ */ new Map();
			const bump = (id, running) => {
				const cur = out.get(id) ?? {
					count: 0,
					runningCount: 0
				};
				out.set(id, {
					count: cur.count + 1,
					runningCount: cur.runningCount + (running ? 1 : 0)
				});
			};
			for (const summary of Object.values(byId)) {
				if (summary === void 0 || summary.origin !== "subagent") continue;
				const running = summary.running === true;
				const seen = /* @__PURE__ */ new Set();
				let parentId = summary.parentId;
				while (parentId !== void 0 && parentId !== "" && !seen.has(parentId)) {
					seen.add(parentId);
					bump(parentId, running);
					const parent = byId[parentId];
					if (parent === void 0 || parent.origin !== "subagent") break;
					parentId = parent.parentId;
				}
			}
			return out;
		}
		/** A blank session's canonical title never enters search; the renderer localizes the label. */
		function sessionTitle(session) {
			return session.blank ? "New Session" : session.displayTitle;
		}
		/** Project a list-row summary into a renderable session node. */
		function sessionNode(session, descendants) {
			return {
				id: session.id,
				title: sessionTitle(session),
				blank: session.blank,
				running: session.running === true,
				runningSubagentCount: descendants.get(session.id)?.runningCount ?? 0,
				completed: session.completed === true,
				updatedAt: session.updatedAt ?? 0,
				...session.pendingInteraction === void 0 ? {} : { pendingInteraction: session.pendingInteraction }
			};
		}
		/** Visible session ids, optionally newest-first when `orderBy` is `updated`. */
		function orderedVisibleSessionIds(workspace, sessions, archivedSessionIds, orderBy) {
			const ids = visibleSessionIds(workspace, sessions, archivedSessionIds);
			if (orderBy !== "updated") return ids;
			return [...ids].sort((a, b) => {
				const left = sessions.byId[a];
				const right = sessions.byId[b];
				return byRecency({
					id: a,
					updatedAt: left?.updatedAt ?? Number.NEGATIVE_INFINITY
				}, {
					id: b,
					updatedAt: right?.updatedAt ?? Number.NEGATIVE_INFINITY
				});
			});
		}
		/**
		* Flat session list ("In one list"): every visible session as a top-level
		* row. `updated` is newest-first; `manual` keeps the session-list stored order.
		*/
		function deriveFlat(list, archivedSessionIds, orderBy = "updated") {
			const archived = new Set(archivedSessionIds);
			const descendants = indexSubagentRunning(list.byId);
			const rows = [];
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0) continue;
				if (summary.origin === "subagent") continue;
				if (archived.has(id)) continue;
				if (summary.blank && id !== list.current) continue;
				rows.push(summary);
			}
			if (orderBy === "updated") rows.sort((a, b) => byRecency({
				id: a.id,
				updatedAt: a.updatedAt ?? 0
			}, {
				id: b.id,
				updatedAt: b.updatedAt ?? 0
			}));
			return rows.map((session) => sessionNode(session, descendants));
		}
		/**
		* Derive the stray-session clusters: sessions no workspace account holds
		* (a deleted-then-recreated registration's leftovers, or history that
		* appeared after first-boot grouping), clustered by their header cwd into
		* VIRTUAL directory groups. The same visibility rule as everywhere else
		* applies (archived hidden, subagent rows never listed, a blank visible
		* only while it IS the current selection — deleting the current session's
		* workspace registration must not make it vanish).
		*
		* Matching against registered workspace paths is case-insensitive
		* (NTFS): one directory must never split into two clusters because of
		* casing drift between a session header and the registry's realpath.
		* @param items - workspace list items (their `sessionIds` projection IS the
		* accounting; the registry guarantees one record per canonical path).
		* @param sessions - session list snapshot.
		* @param archivedSessionIds - registry-global archive set.
		* @returns stray groups in first-appearance order; empty when nothing is loose.
		*/
		function deriveStrayGroups(items, sessions, archivedSessionIds) {
			const accounted = new Set(items.flatMap((workspace) => workspace.sessionIds));
			const registered = /* @__PURE__ */ new Map();
			for (const workspace of items) {
				const key = workspace.path.toLowerCase();
				if (!registered.has(key)) registered.set(key, workspace.title);
			}
			const archived = new Set(archivedSessionIds);
			const clusters = /* @__PURE__ */ new Map();
			for (const id of sessions.ids) {
				if (accounted.has(id)) continue;
				const summary = sessions.byId[id];
				if (summary === void 0) continue;
				if (summary.origin === "subagent") continue;
				if (archived.has(id)) continue;
				if (summary.blank && id !== sessions.current) continue;
				const path = summary.cwd ?? "";
				const key = `stray:${path === "" ? "?" : path.toLowerCase()}`;
				const existing = clusters.get(key);
				if (existing === void 0) clusters.set(key, {
					kind: "stray",
					key,
					path,
					belongsTo: path === "" ? void 0 : registered.get(path.toLowerCase()),
					sessions: [summary]
				});
				else clusters.set(key, {
					...existing,
					sessions: [...existing.sessions, summary]
				});
			}
			return [...clusters.values()];
		}
		/** Display label for the ungrouped bucket row. */
		const UNGROUPED_LABEL = "Ungrouped";
		/**
		* Directory display label: basename of the path (both separators accepted).
		* Ungrouped-bucket fallback for surfaces without a workspace title.
		*/
		function workspaceLabel(cwd) {
			if (cwd === void 0 || cwd === "") return UNGROUPED_LABEL;
			const base = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
			return base !== void 0 && base !== "" ? base : cwd;
		}
		/**
		* Keep controlled input and RPC payload inside the session.search wire
		* contract: strip NULs, cap at 500 UTF-16 code units, and never split a
		* surrogate pair at the cut.
		*/
		function sanitizeSearchQuery(value) {
			const withoutNul = value.replaceAll("\0", "");
			if (withoutNul.length <= 500) return withoutNul;
			let end = 500;
			const last = withoutNul.charCodeAt(end - 1);
			const next = withoutNul.charCodeAt(end);
			if (last >= 55296 && last <= 56319 && next >= 56320 && next <= 57343) end -= 1;
			return withoutNul.slice(0, end);
		}
		/**
		* Compact relative time for session rows, as a structured bucket the
		* renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
		*/
		function relativeTime(updatedAt, now) {
			const MIN = 6e4;
			const HOUR = 36e5;
			const DAY = 864e5;
			const diff = Math.max(0, now - updatedAt);
			if (diff < MIN) return {
				unit: "now",
				n: 0
			};
			if (diff < HOUR) return {
				unit: "minutes",
				n: Math.floor(diff / MIN)
			};
			if (diff < DAY) return {
				unit: "hours",
				n: Math.floor(diff / HOUR)
			};
			if (diff < 30 * DAY) return {
				unit: "days",
				n: Math.floor(diff / DAY)
			};
			if (diff < 365 * DAY) return {
				unit: "months",
				n: Math.floor(diff / (30 * DAY))
			};
			return {
				unit: "years",
				n: Math.floor(diff / (365 * DAY))
			};
		}
		/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
		function timeLabel(updatedAt, now, t) {
			const { unit, n } = relativeTime(updatedAt, now);
			if (unit === "now") return t("time.now");
			if (unit === "minutes") return t("time.minutes", { n });
			if (unit === "hours") return t("time.hours", { n });
			if (unit === "days") return t("time.days", { n });
			if (unit === "months") return t("time.months", { n });
			return t("time.years", { n });
		}
		/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare. */
		function hoverTimeLabel(updatedAt, now, t) {
			const { unit, n } = relativeTime(updatedAt, now);
			if (unit === "now") return t("time.now");
			return t("time.ago", { t: unit === "minutes" ? t("time.minutes", { n }) : unit === "hours" ? t("time.hours", { n }) : unit === "days" ? t("time.days", { n }) : unit === "months" ? t("time.months", { n }) : t("time.years", { n }) });
		}
		/**
		* Absolute creation time through the dictionary's date template (the message
		* clock pattern): `toLocaleString` would follow the browser language, not the
		* app locale.
		*/
		function createdLabel(createdAt, t) {
			const d = new Date(createdAt);
			const pad2 = (v) => String(v).padStart(2, "0");
			return t("hover.created", { time: `${t("date.ymd", {
				y: d.getFullYear(),
				m: d.getMonth() + 1,
				d: d.getDate()
			})} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
		}
		/** Ordinary sessions are visible; among blanks, only the current one. */
		function sessionVisible(session, current, archived) {
			return session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current);
		}
		/**
		* Merge immediate title/Workspace substring matches with ranked Host content
		* matches. Local rows lead newest-first, content-only rows retain backend
		* order, and duplicate sessions receive the backend snippet in place.
		*/
		function deriveSearchResults(list, workspaces, query, archivedSessionIds, content, limit) {
			const q = query.trim().toLowerCase();
			if (q === "") return {
				items: [],
				hasMore: false
			};
			const archived = new Set(archivedSessionIds);
			const descendants = indexSubagentRunning(list.byId);
			const workspaceBySession = /* @__PURE__ */ new Map();
			for (const workspace of workspaces) for (const sessionId of workspace.sessionIds) if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title);
			const labelOf = (summary) => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd);
			const contentBySession = /* @__PURE__ */ new Map();
			for (const item of content.items) if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item);
			const local = [];
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0 || summary.blank || !sessionVisible(summary, list.current, archived)) continue;
				if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary);
			}
			local.sort((a, b) => byRecency({
				id: a.id,
				updatedAt: a.updatedAt ?? 0
			}, {
				id: b.id,
				updatedAt: b.updatedAt ?? 0
			}));
			const ordered = [];
			const included = /* @__PURE__ */ new Set();
			const include = (summary) => {
				if (included.has(summary.id)) return;
				included.add(summary.id);
				ordered.push(summary);
			};
			for (const summary of local) include(summary);
			for (const item of content.items) {
				const summary = list.byId[item.sessionId];
				if (summary !== void 0 && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary);
			}
			return {
				items: ordered.slice(0, limit).map((summary) => {
					const match = contentBySession.get(summary.id);
					const node = sessionNode(summary, descendants);
					return {
						id: node.id,
						title: node.title,
						workspace: labelOf(summary),
						running: node.running,
						runningSubagentCount: node.runningSubagentCount,
						completed: node.completed,
						...summary.pendingInteraction === void 0 ? {} : { pendingInteraction: summary.pendingInteraction },
						...match === void 0 ? {} : { snippet: match.snippet }
					};
				}),
				hasMore: content.hasMore || ordered.length > limit
			};
		}
		//#endregion
		//#region node_modules/.pnpm/@deepseek-ai+dsh-util-works_bc29eb1f35b7b23a837010aec86eeb5e/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
		/**
		* Browser-safe Workspace path and display helpers.
		* @module @deepseek-ai/dsh-util-workspace-path
		*/
		/** Whether a path uses a Windows drive or UNC prefix. */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}
		/**
		* Abbreviate a POSIX home directory for display.
		* @param path - Absolute or already-short display path.
		* @param home - Host account home; absent skips abbreviation.
		* @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
		*/
		function abbreviateHomePath(path, home) {
			if (home === void 0 || home === "") return path;
			if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path;
			const root = home.replace(/\/+$/, "");
			if (root === "" || root === "/") return path;
			if (path.replace(/\/+$/, "") === root) return "~";
			if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`;
			return path;
		}
		//#endregion
		//#region \0git-worktree-css:C:\Users\OYW\.dsh\gitworktree\dsh-worktree-origin-feature-0.1.2-alpha.3\src\client\sidebar-rows.module.css?inline
		const css$1 = "/* Native Rows.module_73286170.css_73286170 transplanted 1:1 (DSW tokens, row-in, reduced-motion).\n * Drag marker classes (dropBefore/dropAfter) are kept for P3; unused in P2. */\n\n.projectRow_73286170,\n.sessionRow_73286170 {\n  cursor: pointer;\n  user-select: none;\n  color: var(--dsw-alias-label-primary);\n  border-radius: 8px;\n  align-items: center;\n  gap: 6px;\n  padding: 0 8px;\n  display: flex;\n}\n\n.projectRow_73286170:hover,\n.sessionRow_73286170:hover,\n.sessionRow_73286170.selected_73286170 {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.searchResultRow_73286170 {\n  box-sizing: border-box;\n  cursor: pointer;\n  text-align: left;\n  width: 100%;\n  min-height: 48px;\n  color: var(--dsw-alias-label-primary);\n  background: 0 0;\n  border: none;\n  border-radius: 8px;\n  flex-direction: column;\n  align-items: stretch;\n  padding: 4px 8px;\n  display: flex;\n}\n\n.searchResultRow_73286170:hover,\n.searchResultRow_73286170.selected_73286170 {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.searchResultHeading_73286170 {\n  align-items: center;\n  min-width: 0;\n  display: flex;\n}\n\n.searchResultTitle_73286170 {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 0;\n  margin-left: 4px;\n  font-size: 14px;\n  line-height: 20px;\n  overflow: hidden;\n}\n\n.searchResultMeta_73286170 {\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  margin-left: 20px;\n  display: flex;\n}\n\n.searchResultWorkspace_73286170,\n.searchResultSnippet_73286170 {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n  line-height: 17px;\n  overflow: hidden;\n}\n\n.searchResultWorkspace_73286170 {\n  max-width: 40%;\n  color: var(--dsw-alias-label-tertiary);\n  flex: none;\n}\n\n.searchResultSnippet_73286170 {\n  min-width: 0;\n  color: var(--dsw-alias-label-secondary);\n  flex: 1;\n}\n\n.projectRow_73286170 {\n  box-sizing: border-box;\n  align-items: center;\n  height: 34px;\n}\n\n.projectRow_73286170 .rowActions_73286170 {\n  height: 20px;\n}\n\n.sessionRow_73286170 {\n  height: 32px;\n  animation: row-in 0.15s var(--ds-ease-in-out);\n  gap: 0;\n}\n\n.sessionRow_73286170 .title_73286170 {\n  margin: 0 6px 0 4px;\n}\n\n.flatSessionRowWithoutStatus_73286170 .title_73286170 {\n  margin-left: 0;\n}\n\n@keyframes row-in {\n  0% { opacity: 0; }\n}\n\n.slot_73286170 {\n  width: 16px;\n  height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  display: inline-flex;\n}\n\n.visuallyHidden_73286170 {\n  clip: rect(0 0 0 0);\n  white-space: nowrap;\n  width: 1px;\n  height: 1px;\n  position: absolute;\n  overflow: hidden;\n}\n\n.folderActive_73286170 {\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.projectRow_73286170 .chevron_73286170 {\n  display: none;\n}\n\n.projectRow_73286170:hover .chevron_73286170 {\n  display: inline-flex;\n}\n\n.projectRow_73286170:hover .folder_73286170 {\n  display: none;\n}\n\n.arrow_73286170 {\n  transition: transform 0.15s var(--ds-ease-in-out);\n}\n\n.arrowOpen_73286170 {\n  transform: rotate(90deg);\n}\n\n.projectText_73286170 {\n  flex-direction: column;\n  flex: 1;\n  gap: 2px;\n  min-width: 0;\n  display: flex;\n}\n\n.title_73286170 {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 0;\n  font-size: 14px;\n  line-height: 20px;\n  overflow: hidden;\n}\n\n/* Virtual (unregistered) directory rows read one weight lighter than real\n * workspace rows — together with the dashed folder glyph, the whole row is\n * distinguishable at a glance. */\n.strayRow_73286170 .title_73286170 {\n  color: var(--dsw-alias-label-secondary);\n}\n\n.renameInput_73286170 {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-button-elevated-fill);\n  min-width: 0;\n  color: inherit;\n  border-radius: 4px;\n  outline: none;\n  padding: 0 2px;\n  font-size: 14px;\n  line-height: 20px;\n}\n\n.sessionRow_73286170 .title_73286170 {\n  flex: 1;\n}\n\n.meta_73286170 {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 20px;\n  overflow: hidden;\n}\n\n.time_73286170 {\n  color: var(--dsw-alias-label-tertiary);\n  flex: none;\n  font-size: 12px;\n  line-height: 20px;\n}\n\n.dot_73286170 {\n  flex: none;\n}\n\n.rowActions_73286170 {\n  flex: none;\n  align-items: center;\n  gap: 12px;\n  display: none;\n}\n\n.projectRow_73286170:hover .rowActions_73286170,\n.sessionRow_73286170:hover .rowActions_73286170,\n.projectRow_73286170.menuOpen_73286170 .rowActions_73286170,\n.sessionRow_73286170.menuOpen_73286170 .rowActions_73286170 {\n  display: inline-flex;\n}\n\n.sessionRow_73286170:hover .time_73286170,\n.sessionRow_73286170.menuOpen_73286170 .time_73286170 {\n  display: none;\n}\n\n.projectRow_73286170.menuOpen_73286170,\n.sessionRow_73286170.menuOpen_73286170 {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* P3: session drag insertion markers (unused in P2). */\n.sessionRow_73286170.dropBefore_73286170,\n.sessionRow_73286170.dropAfter_73286170 {\n  position: relative;\n}\n\n.sessionRow_73286170.dropBefore_73286170:before,\n.sessionRow_73286170.dropAfter_73286170:after {\n  content: \"\";\n  z-index: 1;\n  background:\n    linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat,\n    linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;\n  pointer-events: none;\n  height: 12px;\n  position: absolute;\n  left: 0;\n  right: 4px;\n}\n\n.sessionRow_73286170.dropBefore_73286170:before {\n  top: -7px;\n}\n\n.sessionRow_73286170.dropAfter_73286170:after {\n  bottom: -7px;\n}\n\n.hoverContent_73286170 {\n  flex-direction: column;\n  gap: 8px;\n  display: flex;\n}\n\n.hoverTitle_73286170 {\n  color: #fff;\n  overflow-wrap: break-word;\n  font-size: 14px;\n  line-height: 20px;\n}\n\n.hoverPath_73286170 {\n  color: #cfd3d6;\n  word-break: break-all;\n  font-size: 12px;\n  line-height: 16px;\n}\n\n.hoverTime_73286170 {\n  color: #cfd3d6;\n  font-size: 12px;\n  line-height: 16px;\n}\n\n.hoverStatus_73286170 {\n  color: #adb2b8;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n  line-height: 20px;\n  display: flex;\n}\n\n.iconButton_73286170 {\n  cursor: pointer;\n  width: 16px;\n  height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  background: 0 0;\n  border: none;\n  border-radius: 4px;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  display: inline-flex;\n}\n\n.iconButton_73286170:hover {\n  color: var(--dsw-alias-label-primary);\n}\n\n.chevron_73286170 {\n  color: var(--dsw-alias-label-caption);\n}\n\n.repoCount_73286170 {\n  flex: none;\n  margin-left: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 20px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .sessionRow_73286170,\n  .arrow_73286170 {\n    transition: none;\n    animation: none;\n  }\n}\n";
		const tagId$1 = "@laoyuehanni/dsh-git-worktree/sidebar-rows.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId$1 + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-git-worktree";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var sidebar_rows_module_default = {
			"module": "module_73286170",
			"css": "css_73286170",
			"projectRow": "projectRow_73286170",
			"sessionRow": "sessionRow_73286170",
			"selected": "selected_73286170",
			"searchResultRow": "searchResultRow_73286170",
			"searchResultHeading": "searchResultHeading_73286170",
			"searchResultTitle": "searchResultTitle_73286170",
			"searchResultMeta": "searchResultMeta_73286170",
			"searchResultWorkspace": "searchResultWorkspace_73286170",
			"searchResultSnippet": "searchResultSnippet_73286170",
			"rowActions": "rowActions_73286170",
			"title": "title_73286170",
			"flatSessionRowWithoutStatus": "flatSessionRowWithoutStatus_73286170",
			"slot": "slot_73286170",
			"visuallyHidden": "visuallyHidden_73286170",
			"folderActive": "folderActive_73286170",
			"chevron": "chevron_73286170",
			"folder": "folder_73286170",
			"arrow": "arrow_73286170",
			"arrowOpen": "arrowOpen_73286170",
			"projectText": "projectText_73286170",
			"strayRow": "strayRow_73286170",
			"renameInput": "renameInput_73286170",
			"meta": "meta_73286170",
			"time": "time_73286170",
			"dot": "dot_73286170",
			"menuOpen": "menuOpen_73286170",
			"dropBefore": "dropBefore_73286170",
			"dropAfter": "dropAfter_73286170",
			"hoverContent": "hoverContent_73286170",
			"hoverTitle": "hoverTitle_73286170",
			"hoverPath": "hoverPath_73286170",
			"hoverTime": "hoverTime_73286170",
			"hoverStatus": "hoverStatus_73286170",
			"iconButton": "iconButton_73286170",
			"repoCount": "repoCount_73286170"
		};
		//#endregion
		//#region src/client/sidebar-rows.tsx
		/**
		* Workspace / session / search row components transplanted from the native
		* `Rows.js` (injected props, no ctx). Hover swaps (folder→chevron, time→⋯)
		* are CSS-only. Drag wiring is intentionally omitted — P3.
		*
		* @module git-worktree/client/sidebar-rows
		*/
		function cx$1(...parts) {
			return parts.filter((part) => typeof part === "string" && part !== "").join(" ");
		}
		/** Row display title: blank rows show the localized New Session label. */
		function displayTitle(node, t) {
			return node.blank ? t("session.new") : node.title;
		}
		/** Hover-card body: workspace title, display directory path, absolute creation time. */
		function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: sidebar_rows_module_default.hoverContent,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: sidebar_rows_module_default.hoverTitle,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: sidebar_rows_module_default.hoverPath,
						children: cwd
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: sidebar_rows_module_default.hoverTime,
						children: createdLabel(createdAt, t)
					})
				]
			});
		}
		/**
		* Project (workspace) header row: folder + title; hover reveals the chevron
		* and create button. `containsCurrent` is a derivation fact (no renderer scan).
		* Drag wiring is not transplanted (P3 — `useNativeDragAcceptance` stays vacant).
		*/
		function ProjectRowItem({ row, onToggle, onCreate, actions, home, t, badge }) {
			const active = row.expanded && row.containsCurrent;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const workspaceMenuItems = [
				{
					id: "rename",
					label: t("rename"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})
				},
				...actions?.removeWorktree !== void 0 ? [{
					id: "removeWorktree",
					label: t("worktreeRemove.menu"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
					danger: true
				}] : [],
				{
					id: "delete",
					label: t("delete.workspace"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
					danger: true
				}
			];
			const ownRow = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx$1(sidebar_rows_module_default.projectRow, menuOpen && sidebar_rows_module_default.menuOpen),
				role: "treeitem",
				"aria-expanded": row.expanded,
				onClick: onToggle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: cx$1(sidebar_rows_module_default.slot, sidebar_rows_module_default.folder, active && sidebar_rows_module_default.folderActive),
						children: row.expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: cx$1(sidebar_rows_module_default.slot, sidebar_rows_module_default.chevron),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: cx$1(sidebar_rows_module_default.arrow, row.expanded && sidebar_rows_module_default.arrowOpen) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.projectText,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: sidebar_rows_module_default.title,
							children: row.label
						})
					}),
					badge !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.repoCount,
						children: badge
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: sidebar_rows_module_default.rowActions,
						children: [actions !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items: workspaceMenuItems,
							onSelect: (id) => {
								setMenuOpen(false);
								if (id === "rename") actions.rename();
								else if (id === "removeWorktree") actions.removeWorktree?.();
								else if (id === "delete") actions.delete();
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: sidebar_rows_module_default.iconButton,
								"aria-label": t("actions.workspace.aria", { name: row.label }),
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
							})
						}), onCreate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: sidebar_rows_module_default.iconButton,
							"aria-label": t("actions.newSession.aria", { name: row.label }),
							onClick: (e) => {
								e.stopPropagation();
								onCreate();
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})
						})]
					})
				]
			});
			if (row.createdAt === void 0) return ownRow;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: ownRow,
				content: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {
					label: row.label,
					cwd: row.cwd === void 0 ? void 0 : abbreviateHomePath(row.cwd, home),
					createdAt: row.createdAt,
					t
				}),
				disabled: menuOpen,
				copyText: row.cwd,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		function assertNever(value) {
			throw new Error(`unknown pending interaction: ${String(value)}`);
		}
		/** Final path segment of an absolute directory ('' for the unknown-cwd cluster). */
		function pathBasename(path) {
			if (path === "") return "";
			const parts = path.split(/[\\/]/);
			return parts[parts.length - 1] ?? "";
		}
		/**
		* Dashed folder glyph for virtual (unregistered) directory rows. The icon set
		* ships no dashed variant, so this follows the WorktreeCheck precedent of a
		* module-local SVG: at 16px a dash pattern is a far stronger "directory-shaped
		* but not a registered workspace" mark than the outline/solid stroke contrast
		* it replaces.
		*/
		function StrayFolderGlyph({ size = 16 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M1.75 4.4c0-.91.71-1.65 1.6-1.65h2.47c.45 0 .88.19 1.19.52l.79.86h4.85c.89 0 1.6.74 1.6 1.65v6.05c0 .91-.71 1.65-1.6 1.65H3.35c-.89 0-1.6-.74-1.6-1.65Z",
					stroke: "currentColor",
					strokeWidth: "1.15",
					strokeDasharray: "2 1.6",
					strokeLinejoin: "round",
					strokeLinecap: "round"
				})
			});
		}
		/**
		* One virtual directory row of the stray (Ungrouped) section: DASHED folder
		* (the real workspace rows' folder is solid — the dash pattern is the
		* at-a-glance "this directory is not a registered workspace" mark) +
		* directory basename + session-count badge; hover reveals the full path plus
		* one guidance line — ownership when a registered workspace holds the
		* directory, or the rebuild hint when it is a missing worktree storage slot.
		* The ⋯ menu carries exactly one action: register (directory probed real and
		* unregistered) or rebuild (missing but host-confirmed as a storage slot).
		*/
		function StrayGroupRow({ path, belongsTo, count, expanded, onToggle, onRegister, registering, onRebuild, rebuilding, missingDir, worktreeSlot, home, t }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const label = path === "" ? t("stray.unknown") : pathBasename(path);
			const items = onRegister !== void 0 ? [{
				id: "register",
				label: t("stray.register"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {})
			}] : onRebuild !== void 0 ? [{
				id: "rebuild",
				label: t("stray.rebuild"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {})
			}] : [];
			const row = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx$1(sidebar_rows_module_default.projectRow, sidebar_rows_module_default.strayRow, menuOpen && sidebar_rows_module_default.menuOpen),
				role: "treeitem",
				"aria-expanded": expanded,
				onClick: onToggle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: cx$1(sidebar_rows_module_default.slot, sidebar_rows_module_default.folder),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StrayFolderGlyph, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: cx$1(sidebar_rows_module_default.slot, sidebar_rows_module_default.chevron),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: cx$1(sidebar_rows_module_default.arrow, expanded && sidebar_rows_module_default.arrowOpen) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.projectText,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: sidebar_rows_module_default.title,
							children: label
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.repoCount,
						children: String(count)
					}),
					items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.rowActions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items,
							onSelect: (id) => {
								setMenuOpen(false);
								if (id === "register") onRegister?.();
								if (id === "rebuild") onRebuild?.();
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: sidebar_rows_module_default.iconButton,
								"aria-label": onRegister !== void 0 ? t("stray.register.aria", { name: label }) : t("stray.rebuild.aria", { name: label }),
								disabled: registering === true || rebuilding === true,
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
							})
						})
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: row,
				content: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: sidebar_rows_module_default.hoverContent,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: sidebar_rows_module_default.hoverTitle,
							children: label
						}),
						path !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: sidebar_rows_module_default.hoverPath,
							children: abbreviateHomePath(path, home)
						}),
						belongsTo !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: sidebar_rows_module_default.hoverStatus,
							children: t("stray.belongsTo", { name: belongsTo })
						}),
						missingDir === true && worktreeSlot === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: sidebar_rows_module_default.hoverStatus,
							children: t("stray.worktreeSlot")
						}),
						missingDir === true && worktreeSlot !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: sidebar_rows_module_default.hoverStatus,
							children: t("stray.missingDir")
						})
					]
				}),
				disabled: menuOpen,
				copyText: path === "" ? void 0 : path,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		/** Session status presentation; pending interaction is primary and live activity outranks completion. */
		function sessionStatuses(node, t) {
			const subagents = node.runningSubagentCount === 0 ? void 0 : {
				state: "ongoing",
				label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
			};
			let pending;
			switch (node.pendingInteraction) {
				case "approval":
					pending = {
						state: "warning",
						label: t("status.waitingApproval")
					};
					break;
				case "plan-review":
					pending = {
						state: "warning",
						label: t("status.planReview")
					};
					break;
				case "question":
					pending = {
						state: "warning",
						label: t("status.waitingAnswer")
					};
					break;
				case void 0: break;
				default: return assertNever(node.pendingInteraction);
			}
			if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
			if (node.running) {
				const primary = {
					state: "ongoing",
					label: t("status.running")
				};
				return subagents === void 0 ? [primary] : [primary, subagents];
			}
			if (subagents !== void 0) return [subagents];
			if (node.completed) return [{
				state: "done",
				label: t("status.completed")
			}];
			return [{
				state: "done",
				label: t("status.idle")
			}];
		}
		/** Primary status dot plus every status's screen-reader label. */
		function SessionStatusDots({ statuses }) {
			const primary = statuses[0];
			if (primary === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: primary.state }), statuses.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: sidebar_rows_module_default.visuallyHidden,
				children: status.label
			}, status.label))] });
		}
		/** Hover-card body: full title, relative time, and every relevant live status. */
		function SessionHoverContent({ node, now, t }) {
			const statuses = sessionStatuses(node, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: sidebar_rows_module_default.hoverContent,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: sidebar_rows_module_default.hoverTitle,
						children: displayTitle(node, t)
					}),
					!node.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: sidebar_rows_module_default.hoverTime,
						children: hoverTimeLabel(node.updatedAt, now, t)
					}),
					statuses.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: sidebar_rows_module_default.hoverStatus,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: status.state }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.label })]
					}, status.label))
				]
			});
		}
		/** One flat search result: title, Workspace context, and optional content excerpt. */
		function SearchResultItem({ result, currentId, onOpen, t }) {
			const selected = result.id === currentId;
			const statuses = sessionStatuses(result, t);
			const primaryStatus = statuses[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: cx$1(sidebar_rows_module_default.searchResultRow, selected && sidebar_rows_module_default.selected),
				role: "treeitem",
				"aria-selected": selected,
				onClick: () => {
					onOpen(result.id);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: sidebar_rows_module_default.searchResultHeading,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.slot,
						children: primaryStatus !== void 0 && (primaryStatus.state !== "done" || result.completed) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.searchResultTitle,
						children: result.title
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: sidebar_rows_module_default.searchResultMeta,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.searchResultWorkspace,
						children: result.workspace
					}), result.snippet !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: sidebar_rows_module_default.searchResultSnippet,
						children: result.snippet
					})]
				})]
			});
		}
		/**
		* One 32px session row: status dot, title, relative time, hover ⋯ menu.
		* Drag wiring is not transplanted (P3).
		*/
		function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, flat = false, t }) {
			const title = displayTitle(node, t);
			const selected = node.id === currentId;
			const statuses = sessionStatuses(node, t);
			const showStatus = statuses[0]?.state !== "done" || node.completed;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const sessionMenuItems = [
				{
					id: "rename",
					label: t("rename"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})
				},
				{
					id: "fork",
					label: t("menu.fork"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})
				},
				{
					id: "archive",
					label: t("menu.archiveSession"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: cx$1(sidebar_rows_module_default.sessionRow, selected && sidebar_rows_module_default.selected, menuOpen && sidebar_rows_module_default.menuOpen, flat && !showStatus && sidebar_rows_module_default.flatSessionRowWithoutStatus),
					role: "treeitem",
					"aria-selected": selected,
					onClick: () => {
						onOpen(node.id);
					},
					children: [
						(!flat || showStatus) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: sidebar_rows_module_default.slot,
							children: showStatus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: sidebar_rows_module_default.title,
							children: title
						}),
						!node.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: sidebar_rows_module_default.time,
							children: timeLabel(node.updatedAt, now, t)
						}),
						!node.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: sidebar_rows_module_default.rowActions,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
								open: menuOpen,
								onClose: () => {
									setMenuOpen(false);
								},
								items: sessionMenuItems,
								onSelect: (id) => {
									setMenuOpen(false);
									if (id === "rename") onRename(node.id, node.title);
									if (id === "fork") onFork(node.id);
									if (id === "archive") onArchive(node.id);
								},
								portal: true,
								closeOnPointerLeave: true,
								anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: sidebar_rows_module_default.iconButton,
									"aria-label": t("actions.session.aria", { name: title }),
									onClick: (e) => {
										e.stopPropagation();
										setMenuOpen((v) => !v);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
								})
							})
						})
					]
				}),
				content: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionHoverContent, {
					node,
					now,
					t
				}),
				disabled: menuOpen,
				copyText: node.blank ? void 0 : node.title,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		//#endregion
		//#region src/client/pick-flow.ts
		/**
		* Edge-triggered controller for one add-workspace flow.
		*
		* `sync(open)` mirrors the dialog's open flag: only a RISING edge (closed →
		* open) starts a pick — re-syncing `true` while a run is live is a no-op, so
		* the parent's re-renders (fresh inline callbacks and all) can never
		* re-launch the chooser or drop a finished pick the way an effect keyed on
		* unstable function deps would. A falling edge invalidates any in-flight
		* run: its eventual result is discarded without a callback. `kill()` is the
		* permanent teardown — nothing fires after it.
		*/
		var PickFlowController = class {
			hooks;
			started = false;
			epoch = 0;
			/** Refresh the callbacks to the latest render's closures; never restarts a run. */
			attach(hooks) {
				this.hooks = hooks;
			}
			/** Sync with the dialog's open flag (see the class doc for the edge semantics). */
			sync(open) {
				if (open) {
					if (this.started) return;
					this.started = true;
					this.epoch += 1;
					this.run(this.epoch);
					return;
				}
				this.epoch += 1;
				this.started = false;
			}
			/** Permanent teardown (unmount): no callback fires afterwards. */
			kill() {
				this.epoch += 1;
				this.started = false;
			}
			async run(token) {
				const hooks = this.hooks;
				if (hooks === void 0) return;
				let path;
				try {
					path = await hooks.pickDirectory();
				} catch (reason) {
					if (token === this.epoch) hooks.onFailed(messageOf(reason));
					return;
				}
				if (token !== this.epoch) return;
				if (path === null || path === "") {
					hooks.onCancelled();
					return;
				}
				let workspace;
				try {
					workspace = await hooks.createWorkspace({ path });
				} catch (reason) {
					if (token === this.epoch) hooks.onFailed(messageOf(reason));
					return;
				}
				if (token !== this.epoch) return;
				hooks.onPicked(workspace.workspaceId);
			}
		};
		/** Error text for a rejection of any shape. */
		function messageOf(reason) {
			return reason instanceof Error ? reason.message : String(reason);
		}
		//#endregion
		//#region \0git-worktree-css:C:\Users\OYW\.dsh\gitworktree\dsh-worktree-origin-feature-0.1.2-alpha.3\src\client\GroupedSidebar.module.css?inline
		const css = "/* Native WorkspaceBrowser.module_108469306.css_108469306 + WorkspacePicker.module_108469306.css_108469306 transplanted\n * 1:1 (DSW tokens, search expand, reduced-motion). Drag classes\n * (workspaceDrop*, listTopDrop*) are kept for P3; unused in P2.\n * Overlay: memberIndent / sessionsIndent for the repo-grouped tree. */\n\n.root_108469306 {\n  --dsh-session-list-edge-inset: var(--dsh-sidebar-inline-padding);\n  --dsh-session-list-scrollbar-width: 8px;\n  --dsh-session-list-scrollbar-offset: 2px;\n  box-sizing: border-box;\n  min-height: 0;\n  padding-right: var(--dsh-session-list-edge-inset);\n  flex-direction: column;\n  flex: 1;\n  display: flex;\n}\n\n.root_108469306.rail_108469306 {\n  padding-right: 0;\n}\n\n.iconButton_108469306 {\n  cursor: pointer;\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-secondary);\n  background: 0 0;\n  border: none;\n  border-radius: 50%;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  display: inline-flex;\n}\n\n.iconButton_108469306:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.sectionHeader_108469306 {\n  box-sizing: border-box;\n  height: 36px;\n  color: var(--dsw-alias-label-tertiary);\n  border-radius: 12px;\n  flex: none;\n  justify-content: flex-end;\n  align-items: center;\n  gap: 4px;\n  margin-bottom: 4px;\n  padding-left: 4px;\n  display: flex;\n  overflow: hidden;\n}\n\n.root_108469306:not(.rail_108469306) .sectionHeader_108469306 {\n  margin-top: 2px;\n  margin-right: -4px;\n}\n\n.sectionLabel_108469306 {\n  white-space: nowrap;\n  opacity: 1;\n  visibility: visible;\n  min-width: 0;\n  max-width: 45%;\n  transition: max-width 0.18s var(--ds-ease-in-out), margin-right 0.18s var(--ds-ease-in-out), opacity 0.12s var(--ds-ease-in-out), transform 0.18s var(--ds-ease-in-out), visibility 0s linear;\n  flex: none;\n  line-height: 20px;\n  overflow: hidden;\n}\n\n.sectionLabelHidden_108469306 {\n  opacity: 0;\n  visibility: hidden;\n  max-width: 0;\n  margin-right: -4px;\n  transition-delay: 0s, 0s, 0s, 0s, 0.18s;\n  transform: translate(-4px);\n}\n\n.searchSlot_108469306 {\n  box-sizing: border-box;\n  min-width: 0;\n  max-width: 28px;\n  transition: max-width 0.18s var(--ds-ease-in-out), padding-left 0.18s var(--ds-ease-in-out);\n  flex: 1;\n  align-items: center;\n  margin-left: auto;\n  padding-left: 0;\n  display: flex;\n}\n\n.searchSlotExpanded_108469306 {\n  max-width: 100%;\n  padding-left: 0;\n}\n\n.headerActions_108469306 {\n  opacity: 1;\n  visibility: visible;\n  max-width: 60px;\n  transition: max-width 0.18s var(--ds-ease-in-out), opacity 0.12s var(--ds-ease-in-out), transform 0.18s var(--ds-ease-in-out), visibility 0s linear;\n  flex: none;\n  align-items: center;\n  gap: 4px;\n  display: flex;\n  overflow: hidden;\n}\n\n.headerActionsHidden_108469306 {\n  opacity: 0;\n  visibility: hidden;\n  pointer-events: none;\n  max-width: 0;\n  transition-delay: 0s, 0s, 0s, 0.18s;\n  transform: translate(4px);\n}\n\n.search_108469306 {\n  box-sizing: border-box;\n  cursor: text;\n  width: 100%;\n  height: 28px;\n  color: var(--dsw-alias-label-secondary);\n  transition: width 0.18s var(--ds-ease-in-out), padding 0.18s var(--ds-ease-in-out), border-color 0.18s var(--ds-ease-in-out), background-color 0.18s var(--ds-ease-in-out);\n  background: 0 0;\n  border: none;\n  border-radius: 50%;\n  flex: none;\n  align-items: center;\n  gap: 0;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  overflow: hidden;\n}\n\n.searchExpanded_108469306 {\n  border: 1px solid var(--dsw-alias-border-l2);\n  width: calc(100% + 4px);\n  height: 30px;\n  color: var(--dsw-alias-label-caption);\n  background: 0 0;\n  border-radius: 10px;\n  margin-inline: -2px;\n  padding: 0 4px 0 0;\n}\n\n.searchButton_108469306 {\n  cursor: pointer;\n  width: 28px;\n  height: 28px;\n  color: inherit;\n  background: 0 0;\n  border: none;\n  border-radius: 50%;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  display: inline-flex;\n}\n\n.searchExpanded_108469306 .searchButton_108469306 {\n  width: 28px;\n  height: 30px;\n}\n\n.searchButton_108469306:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.searchExpanded_108469306 .searchButton_108469306:hover {\n  background: 0 0;\n}\n\n.searchInput_108469306 {\n  opacity: 0;\n  pointer-events: none;\n  width: 0;\n  min-width: 0;\n  color: var(--dsw-alias-label-primary);\n  transition: opacity 0.12s var(--ds-ease-in-out);\n  background: 0 0;\n  border: none;\n  outline: none;\n  flex: 1;\n  font-size: 13px;\n  line-height: 18px;\n}\n\n.searchExpanded_108469306 .searchInput_108469306 {\n  opacity: 1;\n  pointer-events: auto;\n  margin-left: -2px;\n}\n\n.searchInput_108469306::placeholder {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.clearButton_108469306 {\n  cursor: pointer;\n  width: 24px;\n  height: 24px;\n  color: var(--dsw-alias-label-secondary);\n  background: 0 0;\n  border: none;\n  border-radius: 50%;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  display: inline-flex;\n}\n\n.clearButton_108469306:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.rail_108469306 .sectionHeader_108469306 {\n  justify-content: flex-start;\n  gap: 0;\n  margin-bottom: 12px;\n  padding-left: 0;\n}\n\n.rail_108469306 .headerActions_108469306 {\n  max-width: none;\n}\n\n.rail_108469306 .iconButton_108469306 {\n  width: 36px;\n  height: 36px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.rail_108469306 .search_108469306 {\n  background: 0 0;\n  border-color: #0000;\n  gap: 0;\n  width: 36px;\n  height: 36px;\n  margin: 0 0 12px;\n  padding: 0;\n}\n\n.rail_108469306 .searchButton_108469306 {\n  width: 36px;\n  height: 36px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.rail_108469306 .searchButton_108469306:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.listArea_108469306 {\n  min-height: 0;\n  margin-left: -4px;\n  margin-right: calc(-1 * var(--dsh-session-list-edge-inset));\n  flex-direction: column;\n  flex: 1;\n  padding-left: 4px;\n  display: flex;\n  overflow: visible;\n}\n\n.rail_108469306 .listArea_108469306 {\n  margin-left: 0;\n  margin-right: 0;\n  padding-left: 0;\n}\n\n.treeBody_108469306 {\n  flex-direction: column;\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  position: relative;\n}\n\n.fade_108469306 {\n  left: 0;\n  right: var(--dsh-session-list-edge-inset);\n  background: linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill));\n  pointer-events: none;\n  height: 24px;\n  position: absolute;\n  bottom: 0;\n}\n\n.wide_108469306 {\n  animation: wide-in 0.2s var(--ds-ease-in-out);\n}\n\n@keyframes wide-in {\n  0% { opacity: 0; }\n}\n\n.list_108469306 {\n  min-height: 0;\n  margin-left: -4px;\n  margin-right: var(--dsh-session-list-scrollbar-offset);\n  padding-left: 4px;\n  padding-right: calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));\n  scrollbar-gutter: stable;\n  flex: 1;\n  padding-bottom: 16px;\n  overflow-y: auto;\n}\n\n.flatList_108469306 > * + *,\n.searchTree_108469306 > [role=treeitem] + [role=treeitem],\n.groupSection_108469306 > * + * {\n  margin-top: 2px;\n}\n\n.searchStatus_108469306,\n.searchWarning_108469306 {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 10px 12px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.searchWarning_108469306 {\n  color: var(--dsw-alias-label-secondary);\n}\n\n.groupSection_108469306 {\n  position: relative;\n}\n\n.groupSection_108469306 + .groupSection_108469306 {\n  margin-top: 4px;\n}\n\n/* P3: workspace drag insertion markers (unused in P2). */\n.listTopDropIndicator_108469306,\n.workspaceDropBefore_108469306:before,\n.workspaceDropAfter_108469306:after {\n  content: \"\";\n  z-index: 1;\n  background:\n    linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat,\n    linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;\n  pointer-events: none;\n  height: 12px;\n  position: absolute;\n  left: 0;\n  right: 0;\n}\n\n.listTopDropIndicator_108469306 {\n  top: -8px;\n  left: 0;\n  right: var(--dsh-session-list-edge-inset);\n}\n\n.listTopDropActive_108469306 > .workspaceDropBefore_108469306:first-child:before {\n  display: none;\n}\n\n.workspaceDropBefore_108469306:before {\n  top: -8px;\n}\n\n.workspaceDropAfter_108469306:after {\n  bottom: -8px;\n}\n\n.sessionOverflowButton_108469306 {\n  cursor: pointer;\n  text-align: left;\n  width: 100%;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  background: 0 0;\n  border: none;\n  border-radius: 8px;\n  padding: 0 12px 0 28px;\n  font-size: 12px;\n}\n\n.groupSection_108469306 > .sessionOverflowButton_108469306 {\n  margin-top: 0;\n}\n\n.sessionOverflowButton_108469306:hover {\n  color: var(--dsw-alias-label-secondary);\n  background: 0 0;\n}\n\n.empty_108469306 {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 16px 12px;\n  font-size: 13px;\n}\n\n.renameInput_108469306 {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  width: 100%;\n  height: 44px;\n  color: var(--dsw-alias-label-primary);\n  background: 0 0;\n  border-radius: 22px;\n  outline: none;\n  padding: 7px 14px;\n  font-size: 14px;\n  font-weight: 400;\n  line-height: 22px;\n}\n\n.renameInput_108469306:disabled {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n.renameError_108469306 {\n  color: var(--dsw-alias-state-error-primary);\n  margin-top: 8px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.deleteAction_108469306:not(:disabled) {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.deleteStatus_108469306 {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n/* Pre-delete facts of the worktree-removal dialog: one line per fact, the\n * destructive one (uncommitted files die with the folder) in error tone. */\n.removeFacts_108469306 {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  margin-top: 8px;\n}\n\n.removeFact_108469306 {\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.removeFactWarn_108469306 {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.modalAction_108469306 {\n  min-width: 72px;\n}\n\n.modalError_108469306,\n.menuStatus_108469306 {\n  margin-top: 8px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.modalError_108469306 {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.menuStatus_108469306 {\n  color: var(--dsw-alias-label-secondary);\n}\n\n/* Aggregation overlay: indent member workspaces and their sessions. */\n.memberIndent_108469306 {\n  margin-left: 16px;\n}\n\n.sessionsIndent_108469306 {\n  margin-left: 8px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .wide_108469306 {\n    animation: none;\n  }\n\n  .search_108469306,\n  .sectionLabel_108469306,\n  .searchSlot_108469306,\n  .searchInput_108469306,\n  .headerActions_108469306 {\n    transition: none;\n  }\n}\n";
		const tagId = "@laoyuehanni/dsh-git-worktree/GroupedSidebar.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-git-worktree";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var GroupedSidebar_module_default = {
			"module": "module_108469306",
			"css": "css_108469306",
			"root": "root_108469306",
			"rail": "rail_108469306",
			"iconButton": "iconButton_108469306",
			"sectionHeader": "sectionHeader_108469306",
			"sectionLabel": "sectionLabel_108469306",
			"sectionLabelHidden": "sectionLabelHidden_108469306",
			"searchSlot": "searchSlot_108469306",
			"searchSlotExpanded": "searchSlotExpanded_108469306",
			"headerActions": "headerActions_108469306",
			"headerActionsHidden": "headerActionsHidden_108469306",
			"search": "search_108469306",
			"searchExpanded": "searchExpanded_108469306",
			"searchButton": "searchButton_108469306",
			"searchInput": "searchInput_108469306",
			"clearButton": "clearButton_108469306",
			"listArea": "listArea_108469306",
			"treeBody": "treeBody_108469306",
			"fade": "fade_108469306",
			"wide": "wide_108469306",
			"list": "list_108469306",
			"flatList": "flatList_108469306",
			"searchTree": "searchTree_108469306",
			"groupSection": "groupSection_108469306",
			"searchStatus": "searchStatus_108469306",
			"searchWarning": "searchWarning_108469306",
			"listTopDropIndicator": "listTopDropIndicator_108469306",
			"workspaceDropBefore": "workspaceDropBefore_108469306",
			"workspaceDropAfter": "workspaceDropAfter_108469306",
			"listTopDropActive": "listTopDropActive_108469306",
			"sessionOverflowButton": "sessionOverflowButton_108469306",
			"empty": "empty_108469306",
			"renameInput": "renameInput_108469306",
			"renameError": "renameError_108469306",
			"deleteAction": "deleteAction_108469306",
			"deleteStatus": "deleteStatus_108469306",
			"removeFacts": "removeFacts_108469306",
			"removeFact": "removeFact_108469306",
			"removeFactWarn": "removeFactWarn_108469306",
			"modalAction": "modalAction_108469306",
			"modalError": "modalError_108469306",
			"menuStatus": "menuStatus_108469306",
			"memberIndent": "memberIndent_108469306",
			"sessionsIndent": "sessionsIndent_108469306"
		};
		//#endregion
		//#region src/client/GroupedSidebar.tsx
		/**
		* GroupedSidebar: the `sidebar.workspaces` seat occupant. P1 aggregation
		* (same-repository workspaces clustered from /group facts) plus a 1:1
		* transplant of the native workspace browser's search, menus, status dots,
		* relative time, view options, rail, and dialogs.
		*
		* Drag-reorder and the native `dsh.workspace.view.v5` store are P3. Adding a
		* workspace uses `workspaces.pickDirectory` rather than re-declaring the
		* `sidebar.workspaces.directoryFlow` child hole (native already declared it;
		* a second declarer throws).
		*
		* @module git-worktree/client/GroupedSidebar
		*/
		function cx(...parts) {
			return parts.filter((part) => typeof part === "string" && part !== "").join(" ");
		}
		function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				onClose: () => {
					setOpen(false);
				},
				items: [
					{
						type: "label",
						id: "group-by",
						text: t("groupBy.label")
					},
					{
						id: "workspace",
						label: t("groupBy.workspace")
					},
					{
						id: "flat",
						label: t("groupBy.flat")
					},
					{
						type: "separator",
						id: "order-by-separator"
					},
					{
						type: "label",
						id: "order-by",
						text: t("orderBy.label")
					},
					{
						id: "manual",
						label: t("orderBy.manual")
					},
					{
						id: "updated",
						label: t("orderBy.updated")
					}
				],
				selectedIds: [groupBy, orderBy],
				onSelect: (id) => {
					if (id === "workspace" || id === "flat") onGroupPick(id);
					else if (id === "manual" || id === "updated") onOrderPick(id);
					setOpen(false);
				},
				align: "end",
				dense: true,
				portal: true,
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("viewOptions.label"),
					side: "bottom",
					delayMs: 500,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: cx(GroupedSidebar_module_default.iconButton, GroupedSidebar_module_default.wide),
						"aria-label": t("viewOptions.label"),
						onClick: () => {
							setOpen((v) => !v);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPersonalizationOutline16, {})
					})
				})
			});
		}
		/** Add-workspace flow: OS directory picker (cannot redeclare native's directoryFlow hole). */
		function WorkspacePickFlow({ open, onClose, onRetry, pickDirectory, createWorkspace, onPick, t }) {
			const [errorOpen, setErrorOpen] = (0, react.useState)(false);
			const [modalError, setModalError] = (0, react.useState)(null);
			const controllerRef = (0, react.useRef)(null);
			const controller = controllerRef.current ?? (controllerRef.current = new PickFlowController());
			controller.attach({
				pickDirectory,
				createWorkspace,
				onPicked: onPick,
				onCancelled: onClose,
				onFailed: (message) => {
					setModalError(message);
					setErrorOpen(true);
					onClose();
				}
			});
			(0, react.useEffect)(() => {
				controller.sync(open);
			}, [open, controller]);
			(0, react.useEffect)(() => () => {
				controller.kill();
			}, [controller]);
			const closeModal = () => {
				setErrorOpen(false);
				setModalError(null);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: errorOpen,
				onClose: closeModal,
				closeLabel: t("close"),
				title: t("folderError.title"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					className: GroupedSidebar_module_default.modalAction,
					onClick: closeModal,
					children: t("cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					className: GroupedSidebar_module_default.modalAction,
					onClick: () => {
						closeModal();
						onRetry();
					},
					children: t("folderError.retry")
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: GroupedSidebar_module_default.modalError,
					role: "alert",
					children: modalError
				})
			});
		}
		function SearchResults({ list, workspaces, archivedSessionIds, query, remote, resultLimit, currentId, onOpen, t }) {
			const currentRemote = remote.query === query ? remote : {
				query,
				status: "loading",
				items: [],
				hasMore: false
			};
			const results = (0, react.useMemo)(() => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit), [
				list,
				workspaces,
				query,
				archivedSessionIds,
				currentRemote,
				resultLimit
			]);
			const pending = currentRemote.status === "loading";
			const failed = currentRemote.status === "error";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx(GroupedSidebar_module_default.treeBody, GroupedSidebar_module_default.wide),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GroupedSidebar_module_default.list,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.searchTree,
							role: "tree",
							"aria-label": t("search.results.aria"),
							children: results.items.map((result) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchResultItem, {
								result,
								currentId,
								onOpen,
								t
							}, result.id))
						}),
						pending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.searchStatus,
							role: "status",
							children: t("search.pending")
						}),
						failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.searchWarning,
							role: "status",
							children: t("search.unavailable")
						}),
						!pending && results.items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.empty,
							children: t("search.noMatches")
						}),
						results.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.searchStatus,
							children: t("search.hasMore", { n: resultLimit })
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: GroupedSidebar_module_default.fade })]
			});
		}
		function FlatListBody({ list, archivedSessionIds, orderBy, currentId, now, onOpen, onRename, onFork, onArchive, t }) {
			const rows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds, orderBy), [
				list,
				archivedSessionIds,
				orderBy
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx(GroupedSidebar_module_default.treeBody, GroupedSidebar_module_default.wide),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: cx(GroupedSidebar_module_default.list, GroupedSidebar_module_default.flatList),
					role: "tree",
					"aria-label": t("section.sessions"),
					children: [rows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: GroupedSidebar_module_default.empty,
						children: t("empty.none")
					}), rows.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionNodeItem, {
						node,
						currentId,
						now,
						onOpen,
						onRename,
						onFork,
						onArchive,
						flat: true,
						t
					}, node.id))]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: GroupedSidebar_module_default.fade })]
			});
		}
		function memberLabel(member, t) {
			if (member.label.type === "main") return member.label.branch === null ? t("sidebarMain") : t("sidebarMainBranch", { branch: member.label.branch });
			if (member.label.type === "linked") return member.label.branch ?? member.workspace.title;
			return member.workspace.title;
		}
		function createdAtMs(createdAt) {
			if (createdAt === void 0 || createdAt === "") return void 0;
			const parsed = Date.parse(createdAt);
			return Number.isNaN(parsed) ? void 0 : parsed;
		}
		function GroupedTree({ groups, footer, sessions, archived, currentSessionId, expandMap, onToggle, expandTo, orderBy, now, home, onOpen, onRename, onFork, onArchive, onWorkspaceRename, onWorkspaceDelete, onWorktreeRemove, startSession, t }) {
			const descendants = (0, react.useMemo)(() => indexSubagentRunning(sessions.byId), [sessions.byId]);
			const [expandedSessionGroups, setExpandedSessionGroups] = (0, react.useState)([]);
			const empty = groups.length === 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx(GroupedSidebar_module_default.treeBody, GroupedSidebar_module_default.wide),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GroupedSidebar_module_default.list,
					role: "tree",
					"aria-label": t("section.workspaces"),
					children: [
						empty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.empty,
							children: t("empty.none")
						}),
						groups.map((group) => {
							if (group.kind === "repo") {
								const memberIds = group.members.map((member) => orderedVisibleSessionIds(member.workspace, sessions, archived, orderBy));
								const visibleCount = memberIds.reduce((sum, ids) => sum + ids.length, 0);
								const containsCurrent = group.members.some((member) => member.workspace.sessionIds.includes(currentSessionId ?? "\0"));
								const open = expandMap[group.key] ?? containsCurrent;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: GroupedSidebar_module_default.groupSection,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRowItem, {
										row: {
											key: group.key,
											label: group.repoName ?? group.key,
											expanded: open,
											containsCurrent
										},
										onToggle: () => {
											onToggle(group.key);
										},
										home,
										t,
										badge: String(visibleCount)
									}), open && group.members.map((member, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberBlock, {
										member,
										indent: true,
										sessionIds: memberIds[index] ?? [],
										sessions,
										currentSessionId,
										expandMap,
										onToggle,
										expandTo,
										descendants,
										expandedSessionGroups,
										setExpandedSessionGroups,
										now,
										home,
										onOpen,
										onRename,
										onFork,
										onArchive,
										onWorkspaceRename,
										onWorkspaceDelete,
										onWorktreeRemove,
										startSession,
										t
									}, member.workspace.workspaceId))]
								}, group.key);
							}
							const member = group.members[0];
							if (member === void 0) return null;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.groupSection,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberBlock, {
									member,
									indent: false,
									sessionIds: orderedVisibleSessionIds(member.workspace, sessions, archived, orderBy),
									sessions,
									currentSessionId,
									expandMap,
									onToggle,
									expandTo,
									descendants,
									expandedSessionGroups,
									setExpandedSessionGroups,
									now,
									home,
									onOpen,
									onRename,
									onFork,
									onArchive,
									onWorkspaceRename,
									onWorkspaceDelete,
									onWorktreeRemove,
									startSession,
									t
								})
							}, group.key);
						}),
						footer
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: GroupedSidebar_module_default.fade })]
			});
		}
		function MemberBlock({ member, indent, sessionIds, sessions, currentSessionId, expandMap, onToggle, expandTo, descendants, expandedSessionGroups, setExpandedSessionGroups, now, home, onOpen, onRename, onFork, onArchive, onWorkspaceRename, onWorkspaceDelete, onWorktreeRemove, startSession, t }) {
			const key = `ws:${member.workspace.workspaceId}`;
			const containsCurrent = member.workspace.sessionIds.includes(currentSessionId ?? "\0");
			const open = expandMap[key] ?? containsCurrent;
			const label = memberLabel(member, t);
			const overflowOpen = expandedSessionGroups.includes(key);
			const visibleIds = overflowOpen ? sessionIds : sessionIds.slice(0, 5);
			const nodes = [];
			for (const sessionId of visibleIds) {
				const summary = sessions.byId[sessionId];
				if (summary !== void 0) nodes.push(sessionNode(summary, descendants));
			}
			const created = createdAtMs(member.workspace.createdAt);
			const hasRunning = member.workspace.sessionIds.some((id) => sessions.byId[id]?.running === true);
			const occupied = containsCurrent || hasRunning;
			const canRemoveWorktree = member.label.type === "linked" && !occupied;
			const body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRowItem, {
				row: {
					key,
					label,
					expanded: open,
					containsCurrent,
					cwd: member.workspace.path,
					...created === void 0 ? {} : { createdAt: created }
				},
				onToggle: () => {
					onToggle(key);
				},
				onCreate: () => {
					expandTo(key);
					startSession(member.workspace.workspaceId);
				},
				actions: {
					rename: () => {
						onWorkspaceRename(member.workspace.workspaceId, member.workspace.title);
					},
					delete: () => {
						onWorkspaceDelete(member.workspace.workspaceId, member.workspace.title);
					},
					...canRemoveWorktree ? { removeWorktree: () => {
						onWorktreeRemove(member);
					} } : {}
				},
				home,
				t
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: indent ? GroupedSidebar_module_default.sessionsIndent : void 0,
				children: [nodes.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionNodeItem, {
					node,
					currentId: currentSessionId,
					now,
					onOpen,
					onRename,
					onFork,
					onArchive,
					t
				}, node.id)), sessionIds.length > 5 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: GroupedSidebar_module_default.sessionOverflowButton,
					"aria-expanded": overflowOpen,
					onClick: () => {
						setExpandedSessionGroups((keys) => keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
					},
					children: overflowOpen ? t("sessions.collapse") : t("sessions.expand", { n: sessionIds.length - 5 })
				})]
			})] });
			return indent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: GroupedSidebar_module_default.memberIndent,
				children: body
			}) : body;
		}
		function GroupedSidebar(props) {
			const { t } = props;
			const workspaces = (0, react.useSyncExternalStore)(props.workspacesList.subscribe, props.workspacesList.getSnapshot);
			const sessions = (0, react.useSyncExternalStore)(props.sessionsList.subscribe, props.sessionsList.getSnapshot);
			const host = (0, react.useSyncExternalStore)(props.hostInfo.subscribe, props.hostInfo.getSnapshot);
			const directoryFlowAvailable = (0, react.useSyncExternalStore)(props.directoryFlow.subscribe, props.directoryFlow.getSnapshot);
			const items = workspaces.items;
			const home = host?.home;
			const signature = (0, react.useMemo)(() => [...items].map((item) => item.path).sort().join("\n"), [items]);
			const [factsState, setFactsState] = (0, react.useState)(null);
			const readyOnce = (0, react.useRef)(false);
			const signalReady = () => {
				if (readyOnce.current) return;
				readyOnce.current = true;
				props.onReady?.();
			};
			(0, react.useEffect)(() => {
				if (factsState?.signature === signature) {
					signalReady();
					return;
				}
				let live = true;
				props.loadFacts(items.map((item) => item.path)).then((facts) => {
					if (!live) return;
					if (facts !== void 0) setFactsState({
						signature,
						facts
					});
					signalReady();
				}, () => {
					if (live) signalReady();
				});
				return () => {
					live = false;
				};
			}, [
				signature,
				factsState?.signature,
				props.loadFacts,
				items
			]);
			const facts = factsState?.signature === signature ? factsState.facts : void 0;
			const groups = (0, react.useMemo)(() => deriveSidebarGroups(items, facts), [items, facts]);
			const sessionList = sessions;
			const archived = workspaces.archivedSessionIds;
			const [expandMap, setExpandMap] = (0, react.useState)(() => loadExpandState());
			const toggle = (key) => {
				const next = {
					...expandMap,
					[key]: !(expandMap[key] ?? false)
				};
				setExpandMap(next);
				saveExpandState(next);
			};
			const expandTo = (key) => {
				if (expandMap[key] === true) return;
				const next = {
					...expandMap,
					[key]: true
				};
				setExpandMap(next);
				saveExpandState(next);
			};
			const [viewPrefs, setViewPrefs] = (0, react.useState)(() => loadViewPrefs());
			const setGroupBy = (groupBy) => {
				const next = {
					...viewPrefs,
					groupBy
				};
				setViewPrefs(next);
				saveViewPrefs(next);
			};
			const setOrderBy = (orderBy) => {
				const next = {
					...viewPrefs,
					orderBy
				};
				setViewPrefs(next);
				saveViewPrefs(next);
			};
			const [query, setQuery] = (0, react.useState)("");
			const [searchExpanded, setSearchExpanded] = (0, react.useState)(false);
			const normalizedQuery = sanitizeSearchQuery(query).trim();
			const [remoteSearch, setRemoteSearch] = (0, react.useState)({
				query: "",
				status: "idle",
				items: [],
				hasMore: false
			});
			const searchRoot = (0, react.useRef)(null);
			const searchInput = (0, react.useRef)(null);
			const [wsPickerOpen, setWsPickerOpen] = (0, react.useState)(false);
			const composingRef = (0, react.useRef)(false);
			const [searchOnExpand, setSearchOnExpand] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (props.wide && searchOnExpand) {
					const timer = window.setTimeout(() => {
						searchInput.current?.focus({ preventScroll: true });
						setSearchOnExpand(false);
					}, 300);
					return () => {
						window.clearTimeout(timer);
					};
				}
			}, [props.wide, searchOnExpand]);
			(0, react.useEffect)(() => {
				if (!props.wide || !searchExpanded || searchOnExpand) return;
				searchInput.current?.focus({ preventScroll: true });
			}, [
				props.wide,
				searchExpanded,
				searchOnExpand
			]);
			(0, react.useEffect)(() => {
				if (!props.wide || !searchExpanded || searchOnExpand) return;
				const onClick = (event) => {
					if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return;
					searchInput.current?.blur();
					if (normalizedQuery !== "") return;
					setSearchExpanded(false);
				};
				document.addEventListener("click", onClick);
				return () => {
					document.removeEventListener("click", onClick);
				};
			}, [
				normalizedQuery,
				props.wide,
				searchExpanded,
				searchOnExpand
			]);
			(0, react.useEffect)(() => {
				if (normalizedQuery === "") {
					setRemoteSearch({
						query: "",
						status: "idle",
						items: [],
						hasMore: false
					});
					return;
				}
				const controller = new AbortController();
				setRemoteSearch({
					query: normalizedQuery,
					status: "loading",
					items: [],
					hasMore: false
				});
				const timer = window.setTimeout(() => {
					props.searchSessions(normalizedQuery, controller.signal).then((result) => {
						if (controller.signal.aborted) return;
						setRemoteSearch({
							query: normalizedQuery,
							status: "ready",
							items: result.items,
							hasMore: result.hasMore
						});
					}).catch(() => {
						if (controller.signal.aborted) return;
						setRemoteSearch({
							query: normalizedQuery,
							status: "error",
							items: [],
							hasMore: false
						});
					});
				}, 250);
				return () => {
					window.clearTimeout(timer);
					controller.abort();
				};
			}, [normalizedQuery, props.searchSessions]);
			const [renameTarget, setRenameTarget] = (0, react.useState)(null);
			const [renameDraft, setRenameDraft] = (0, react.useState)("");
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [renameError, setRenameError] = (0, react.useState)(null);
			const renameTrimmed = renameDraft.trim();
			const renameDuplicate = renameTarget !== null && renameTrimmed !== "" && renameTrimmed !== renameTarget.currentTitle && items.some((w) => w.title === renameTrimmed);
			const renameBlocked = renaming || renameTrimmed === "" || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate;
			const closeRename = () => {
				if (renaming) return;
				setRenameTarget(null);
				setRenameError(null);
			};
			const confirmRename = () => {
				if (renameBlocked || renameTarget === null) return;
				setRenaming(true);
				setRenameError(null);
				props.renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
					setRenaming(false);
					setRenameTarget(null);
				}).catch((reason) => {
					setRenaming(false);
					setRenameError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const [sessionRenameTarget, setSessionRenameTarget] = (0, react.useState)(null);
			const [sessionRenameDraft, setSessionRenameDraft] = (0, react.useState)("");
			const [sessionRenaming, setSessionRenaming] = (0, react.useState)(false);
			const [sessionRenameError, setSessionRenameError] = (0, react.useState)(null);
			const sessionRenameTrimmed = sessionRenameDraft.trim();
			const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === "" || sessionRenameTarget === null;
			const closeSessionRename = () => {
				if (sessionRenaming) return;
				setSessionRenameTarget(null);
				setSessionRenameError(null);
			};
			const confirmSessionRename = () => {
				if (sessionRenameBlocked || sessionRenameTarget === null) return;
				setSessionRenaming(true);
				setSessionRenameError(null);
				props.renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
					setSessionRenaming(false);
					setSessionRenameTarget(null);
				}).catch((reason) => {
					setSessionRenaming(false);
					setSessionRenameError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const onSessionRename = (sessionId, currentTitle) => {
				setSessionRenameTarget({
					sessionId,
					currentTitle
				});
				setSessionRenameDraft(currentTitle);
				setSessionRenameError(null);
			};
			const onSessionArchive = (sessionId) => {
				props.archiveSession(sessionId).catch((reason) => {
					console.warn("session archive rejected:", reason);
				});
			};
			const [deleteTarget, setDeleteTarget] = (0, react.useState)(null);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [deleteCommittedId, setDeleteCommittedId] = (0, react.useState)(null);
			const [deleteError, setDeleteError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (deleteCommittedId === null || items.some((workspace) => workspace.workspaceId === deleteCommittedId)) return;
				setDeleting(false);
				setDeleteCommittedId(null);
				setDeleteTarget(null);
			}, [deleteCommittedId, items]);
			const closeDelete = () => {
				if (deleting) return;
				setDeleteTarget(null);
				setDeleteError(null);
			};
			const confirmDelete = () => {
				if (deleting || deleteTarget === null) return;
				setDeleting(true);
				setDeleteCommittedId(null);
				setDeleteError(null);
				props.deleteWorkspace(deleteTarget.workspaceId).then(() => {
					setDeleteCommittedId(deleteTarget.workspaceId);
				}).catch((reason) => {
					setDeleting(false);
					setDeleteError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const [wtRemoveTarget, setWtRemoveTarget] = (0, react.useState)(null);
			const [wtInspect, setWtInspect] = (0, react.useState)({ status: "loading" });
			const [wtRemoving, setWtRemoving] = (0, react.useState)(false);
			const [wtRemoveError, setWtRemoveError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (wtRemoveTarget === null) return;
				setWtInspect({ status: "loading" });
				let live = true;
				props.inspectWorktree(wtRemoveTarget.workspace.path).then((facts) => {
					if (live) setWtInspect({
						status: "ready",
						dirty: facts.dirty,
						ahead: facts.ahead
					});
				}, (reason) => {
					if (live) setWtInspect({
						status: "error",
						error: reason instanceof Error ? reason.message : String(reason)
					});
				});
				return () => {
					live = false;
				};
			}, [wtRemoveTarget]);
			const archivedSet = (0, react.useMemo)(() => new Set(archived), [archived]);
			const wtArchiveIds = wtRemoveTarget === null ? [] : wtRemoveTarget.workspace.sessionIds.filter((id) => {
				const summary = sessionList.byId[id];
				return summary !== void 0 && !archivedSet.has(id) && !summary.blank && summary.origin !== "subagent";
			});
			const closeWtRemove = () => {
				if (wtRemoving) return;
				setWtRemoveTarget(null);
				setWtRemoveError(null);
			};
			const confirmWtRemove = () => {
				if (wtRemoving || wtRemoveTarget === null || wtInspect.status !== "ready") return;
				const target = wtRemoveTarget;
				setWtRemoving(true);
				setWtRemoveError(null);
				(async () => {
					try {
						await props.removeWorktree(target.workspace.path, wtInspect.dirty > 0);
						for (const sessionId of wtArchiveIds) await props.archiveSession(sessionId).catch((reason) => {
							console.warn("session archive rejected during worktree removal:", reason);
						});
						await props.deleteWorkspace(target.workspace.workspaceId);
						setWtRemoving(false);
						setWtRemoveTarget(null);
					} catch (reason) {
						setWtRemoving(false);
						setWtRemoveError(reason instanceof Error ? reason.message : String(reason));
					}
				})();
			};
			const now = Date.now();
			const strayGroups = (0, react.useMemo)(() => deriveStrayGroups(items, sessionList, archived), [
				items,
				sessionList,
				archived
			]);
			const strayDescendants = (0, react.useMemo)(() => indexSubagentRunning(sessionList.byId), [sessionList.byId]);
			const strayProbePaths = (0, react.useMemo)(() => [...new Set(strayGroups.filter((group) => group.belongsTo === void 0 && group.path !== "").map((group) => group.path))], [strayGroups]);
			const strayProbeSignature = strayProbePaths.join("\n");
			const [strayDirExists, setStrayDirExists] = (0, react.useState)(void 0);
			const [straySlotRebuildable, setStraySlotRebuildable] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (strayProbePaths.length === 0) return;
				let live = true;
				props.probeDirectories(strayProbePaths).then((result) => {
					if (!live) return;
					setStrayDirExists(result?.exists);
					setStraySlotRebuildable(result?.rebuildable);
				}, () => {
					if (live) {
						setStrayDirExists(void 0);
						setStraySlotRebuildable(void 0);
					}
				});
				return () => {
					live = false;
				};
			}, [strayProbeSignature]);
			const straySectionKey = "stray:section";
			const strayContainsCurrent = strayGroups.some((group) => group.sessions.some((session) => session.id === sessions.current));
			const straySectionOpen = expandMap[straySectionKey] ?? strayContainsCurrent;
			const strayTotal = strayGroups.reduce((sum, group) => sum + group.sessions.length, 0);
			const [strayRegPath, setStrayRegPath] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			const registerStrayWorkspace = (path) => {
				if (strayRegPath !== null) return;
				setStrayRegPath(path);
				props.createWorkspace({ path }).then(() => {
					setStrayRegPath(null);
				}, (reason) => {
					setStrayRegPath(null);
					setToast({
						seq: Date.now(),
						text: t("stray.registerFailed", { message: reason instanceof Error ? reason.message : String(reason) })
					});
				});
			};
			const [strayRebuildPath, setStrayRebuildPath] = (0, react.useState)(null);
			const rebuildStrayDirectory = (path) => {
				if (strayRebuildPath !== null) return;
				setStrayRebuildPath(path);
				props.ensureDirectory(path).then(() => {
					setStrayRebuildPath(null);
					setToast({
						seq: Date.now(),
						text: t("stray.rebuildDone")
					});
					props.probeDirectories([path]).then((result) => {
						if (result === void 0) return;
						setStrayDirExists((current) => ({
							...current,
							...result.exists
						}));
						setStraySlotRebuildable((current) => ({
							...current,
							...result.rebuildable
						}));
					});
				}, (reason) => {
					setStrayRebuildPath(null);
					setToast({
						seq: Date.now(),
						text: t("stray.rebuildFailed", { message: reason instanceof Error ? reason.message : String(reason) })
					});
				});
			};
			const straySection = strayGroups.length === 0 ? void 0 : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: GroupedSidebar_module_default.groupSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRowItem, {
					row: {
						key: straySectionKey,
						label: t("group.ungrouped"),
						expanded: straySectionOpen,
						containsCurrent: strayContainsCurrent
					},
					onToggle: () => {
						toggle(straySectionKey);
					},
					home,
					t,
					badge: String(strayTotal)
				}), straySectionOpen && strayGroups.map((group) => {
					const groupOpen = expandMap[group.key] ?? group.sessions.some((session) => session.id === sessions.current);
					const registrable = group.belongsTo === void 0 && group.path !== "" && strayDirExists?.[group.path] === true;
					const missingDir = group.belongsTo === void 0 && group.path !== "" && strayDirExists?.[group.path] === false;
					const rebuildable = missingDir && straySlotRebuildable?.[group.path] === true;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: cx(GroupedSidebar_module_default.groupSection, GroupedSidebar_module_default.memberIndent),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StrayGroupRow, {
							path: group.path,
							belongsTo: group.belongsTo,
							count: group.sessions.length,
							expanded: groupOpen,
							onToggle: () => {
								toggle(group.key);
							},
							missingDir,
							worktreeSlot: rebuildable,
							...registrable ? {
								onRegister: () => {
									registerStrayWorkspace(group.path);
								},
								registering: strayRegPath === group.path
							} : rebuildable ? {
								onRebuild: () => {
									rebuildStrayDirectory(group.path);
								},
								rebuilding: strayRebuildPath === group.path
							} : {},
							home,
							t
						}), groupOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.sessionsIndent,
							children: group.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionNodeItem, {
								node: sessionNode(session, strayDescendants),
								currentId: sessions.current,
								now,
								onOpen: props.openSession,
								onRename: onSessionRename,
								onFork: props.forkSession,
								onArchive: onSessionArchive,
								t
							}, session.id))
						})]
					}, group.key);
				})]
			});
			const wide = props.wide;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx(GroupedSidebar_module_default.root, !wide && GroupedSidebar_module_default.rail),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GroupedSidebar_module_default.sectionHeader,
						children: [
							wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: cx(GroupedSidebar_module_default.sectionLabel, GroupedSidebar_module_default.wide, searchExpanded && GroupedSidebar_module_default.sectionLabelHidden),
								children: viewPrefs.groupBy === "flat" ? t("section.sessions") : t("section.workspaces")
							}),
							wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: cx(GroupedSidebar_module_default.searchSlot, searchExpanded && GroupedSidebar_module_default.searchSlotExpanded),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									ref: searchRoot,
									className: cx(GroupedSidebar_module_default.search, searchExpanded && GroupedSidebar_module_default.searchExpanded),
									onClick: () => {
										setWsPickerOpen(false);
										setSearchExpanded(true);
										searchInput.current?.focus();
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("search"),
											side: "bottom",
											delayMs: 500,
											disabled: searchExpanded,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: GroupedSidebar_module_default.searchButton,
												"aria-label": t("search.sessions.aria"),
												"aria-expanded": searchExpanded,
												onClick: () => {
													setWsPickerOpen(false);
													setSearchExpanded(true);
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: searchExpanded ? 11 : 14 })
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											ref: searchInput,
											className: GroupedSidebar_module_default.searchInput,
											type: "text",
											placeholder: t("search.placeholder"),
											maxLength: 500,
											value: query,
											tabIndex: searchExpanded ? 0 : -1,
											onChange: (e) => {
												setQuery(sanitizeSearchQuery(e.target.value));
											},
											onKeyDown: (e) => {
												if (e.key !== "Escape") return;
												setQuery("");
												setSearchExpanded(false);
											}
										}),
										searchExpanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: GroupedSidebar_module_default.clearButton,
											"aria-label": t("search.clear"),
											onClick: (e) => {
												e.stopPropagation();
												setQuery("");
												setSearchExpanded(false);
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFill14, {})
										})
									]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: cx(GroupedSidebar_module_default.headerActions, wide && searchExpanded && GroupedSidebar_module_default.headerActionsHidden),
								children: [wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {
									groupBy: viewPrefs.groupBy,
									orderBy: viewPrefs.orderBy,
									onGroupPick: setGroupBy,
									onOrderPick: setOrderBy,
									t
								}), directoryFlowAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("workspace.add"),
									side: "bottom",
									delayMs: 500,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: GroupedSidebar_module_default.iconButton,
										"aria-label": t("workspace.add"),
										onClick: () => {
											setWsPickerOpen((v) => !v);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: wide ? 16 : 18 })
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
								t,
								open: wsPickerOpen,
								pickDirectory: props.pickDirectory,
								createWorkspace: props.createWorkspace,
								onPick: (workspaceId) => {
									setWsPickerOpen(false);
									props.startSession(workspaceId);
								},
								onClose: () => {
									setWsPickerOpen(false);
								},
								onRetry: () => {
									setWsPickerOpen(true);
								}
							})
						]
					}),
					!wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: GroupedSidebar_module_default.search,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("search"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: GroupedSidebar_module_default.searchButton,
								"aria-label": t("search.sessions.aria"),
								onClick: () => {
									setSearchExpanded(true);
									setSearchOnExpand(true);
									props.expandSidebar();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: 18 })
							})
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: GroupedSidebar_module_default.listArea,
						children: wide && (normalizedQuery !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchResults, {
							list: sessionList,
							workspaces: items,
							archivedSessionIds: archived,
							query: normalizedQuery,
							remote: remoteSearch,
							resultLimit: props.searchResultLimit,
							currentId: sessions.current,
							onOpen: props.openSession,
							t
						}) : viewPrefs.groupBy === "flat" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FlatListBody, {
							list: sessionList,
							archivedSessionIds: archived,
							orderBy: viewPrefs.orderBy,
							currentId: sessions.current,
							now,
							onOpen: props.openSession,
							onRename: onSessionRename,
							onFork: props.forkSession,
							onArchive: onSessionArchive,
							t
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupedTree, {
							groups,
							footer: straySection,
							sessions: sessionList,
							archived,
							currentSessionId: sessions.current,
							expandMap,
							onToggle: toggle,
							expandTo,
							orderBy: viewPrefs.orderBy,
							now,
							home,
							onOpen: props.openSession,
							onRename: onSessionRename,
							onFork: props.forkSession,
							onArchive: onSessionArchive,
							onWorkspaceRename: (workspaceId, currentTitle) => {
								setRenameTarget({
									workspaceId,
									currentTitle
								});
								setRenameDraft(currentTitle);
								setRenameError(null);
							},
							onWorkspaceDelete: (workspaceId, title) => {
								setDeleteTarget({
									workspaceId,
									title
								});
								setDeleteError(null);
							},
							onWorktreeRemove: (member) => {
								setWtRemoveTarget(member);
								setWtRemoveError(null);
							},
							startSession: props.startSession,
							t
						}))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: renameTarget !== null,
						onClose: closeRename,
						closeLabel: t("close"),
						title: t("rename.workspace.title"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: renaming,
							onClick: closeRename,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: renameBlocked,
							onClick: confirmRename,
							children: t("rename")
						})] }),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: GroupedSidebar_module_default.renameInput,
								value: renameDraft,
								"aria-label": t("field.workspaceName"),
								autoFocus: true,
								disabled: renaming,
								onFocus: (e) => {
									e.target.select();
								},
								onChange: (e) => {
									setRenameDraft(e.target.value);
									setRenameError(null);
								},
								onCompositionStart: () => {
									composingRef.current = true;
								},
								onCompositionEnd: () => {
									composingRef.current = false;
								},
								onKeyDown: (e) => {
									if (e.key === "Enter" && !composingRef.current) {
										e.preventDefault();
										confirmRename();
									}
								}
							}),
							renameDuplicate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.renameError,
								role: "alert",
								children: t("conflict.named", { name: renameTrimmed })
							}),
							renameError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.renameError,
								role: "alert",
								children: renameError
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: sessionRenameTarget !== null,
						onClose: closeSessionRename,
						closeLabel: t("close"),
						title: t("rename.session.title"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: sessionRenaming,
							onClick: closeSessionRename,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: sessionRenameBlocked,
							onClick: confirmSessionRename,
							children: t("rename")
						})] }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: GroupedSidebar_module_default.renameInput,
							value: sessionRenameDraft,
							"aria-label": t("field.sessionName"),
							autoFocus: true,
							disabled: sessionRenaming,
							onFocus: (e) => {
								e.target.select();
							},
							onChange: (e) => {
								setSessionRenameDraft(e.target.value);
								setSessionRenameError(null);
							},
							onCompositionStart: () => {
								composingRef.current = true;
							},
							onCompositionEnd: () => {
								composingRef.current = false;
							},
							onKeyDown: (e) => {
								if (e.key === "Enter" && !composingRef.current) {
									e.preventDefault();
									confirmSessionRename();
								}
							}
						}), sessionRenameError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.renameError,
							role: "alert",
							children: sessionRenameError
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: deleteTarget !== null,
						onClose: closeDelete,
						closeLabel: t("close"),
						title: t("delete.workspace"),
						...deleteTarget === null ? {} : { description: t("delete.desc", { name: deleteTarget.title }) },
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: deleting,
							onClick: closeDelete,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							className: GroupedSidebar_module_default.deleteAction,
							disabled: deleting,
							onClick: confirmDelete,
							children: t("delete.workspace")
						})] }),
						children: [deleting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.deleteStatus,
							role: "status",
							children: t("delete.pending")
						}), deleteError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GroupedSidebar_module_default.renameError,
							role: "alert",
							children: deleteError
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: wtRemoveTarget !== null,
						onClose: closeWtRemove,
						closeLabel: t("close"),
						title: t("worktreeRemove.title"),
						...wtRemoveTarget === null ? {} : { description: t("worktreeRemove.desc", { path: wtRemoveTarget.workspace.path }) },
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: wtRemoving,
							onClick: closeWtRemove,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							className: GroupedSidebar_module_default.deleteAction,
							disabled: wtRemoving || wtInspect.status !== "ready",
							onClick: confirmWtRemove,
							children: t("worktreeRemove.menu")
						})] }),
						children: [
							wtRemoveTarget?.label.type === "linked" && wtRemoveTarget.label.branch !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.removeFact,
								children: t("worktreeRemove.descBranch", { branch: wtRemoveTarget.label.branch })
							}),
							wtInspect.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.deleteStatus,
								role: "status",
								children: t("worktreeRemove.inspecting")
							}),
							wtInspect.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.renameError,
								role: "alert",
								children: wtInspect.error
							}),
							wtInspect.status === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: GroupedSidebar_module_default.removeFacts,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: cx(GroupedSidebar_module_default.removeFact, wtInspect.dirty > 0 && GroupedSidebar_module_default.removeFactWarn),
										children: wtInspect.dirty > 0 ? t(wtInspect.dirty === 1 ? "worktreeRemove.dirty.one" : "worktreeRemove.dirty.other", { n: wtInspect.dirty }) : t("worktreeRemove.clean")
									}),
									wtInspect.ahead !== void 0 && wtInspect.ahead > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: GroupedSidebar_module_default.removeFact,
										children: t("worktreeRemove.ahead", { n: wtInspect.ahead })
									}),
									wtArchiveIds.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: GroupedSidebar_module_default.removeFact,
										children: t(wtArchiveIds.length === 1 ? "worktreeRemove.sessions.one" : "worktreeRemove.sessions.other", { n: wtArchiveIds.length })
									})
								]
							}),
							wtRemoving && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.deleteStatus,
								role: "status",
								children: t("worktreeRemove.busy")
							}),
							wtRemoveError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GroupedSidebar_module_default.renameError,
								role: "alert",
								children: wtRemoveError
							})
						]
					}),
					toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: toast.text,
						onDone: () => {
							setToast(null);
						}
					}, toast.seq)
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** English dictionary — complete by construction. */
		const en = {
			chipWorktree: "Worktree",
			worktreeToggle: "Create an isolated worktree",
			menuBranches: "Branches",
			menuLocalBranches: "Local branches",
			menuWorktrees: "Worktrees",
			menuRemoteBranches: "Remote branches",
			mainRepoOnly: "Branch operations start from the main checkout",
			menuSearchPlaceholder: "Search branches",
			menuNoMatches: "No matching branches",
			menuNoBranches: "No branches yet",
			menuLocate: "Locate current branch",
			menuExpandAll: "Expand all",
			menuCollapseAll: "Collapse all",
			menuNewBranch: "Create branch from current",
			menuNewBranchPlaceholder: "New branch name",
			menuNewBranchBad: "Git will not accept this name",
			menuNewBranchExists: "A branch with this name already exists",
			menuFetch: "Fetch",
			menuUpdate: "Update current branch from upstream",
			fetchDone: "Remote branches synced",
			updateDone: "{branch} fast-forwarded to its upstream",
			updateUpToDate: "Already up to date",
			aheadTitle: "{n} commits ahead of upstream",
			behindTitle: "{n} commits behind upstream",
			switchAsk: "Switch to {branch}?",
			switchAskRemote: "Check out this remote branch?",
			switchBusy: "Switching…",
			worktreeAskNew: "Create a worktree from {branch}?",
			worktreeAskRemote: "Create a worktree from this remote branch?",
			worktreeAskReuse: "Switch to the {branch} worktree?",
			worktreeAskCutOut: "Cut a new branch out of {branch} into an isolated worktree",
			worktreeBusy: "Creating…",
			createBranchTitle: "New branch from {branch}",
			createBranchBusy: "Creating…",
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
			cardSaving: "Saving…",
			sidebarSectionTitle: "Workspaces",
			sidebarAddSession: "Start a new session",
			sidebarNewSession: "New Session",
			sidebarMainBranch: "Main ({branch})",
			sidebarMain: "Main",
			sidebarRailExpand: "Expand sidebar",
			cardGroupSidebarLabel: "Group workspaces",
			cardGroupSidebarHint: "DSH does not yet expose a multi-workspace grouping API, so this replaces the native sidebar 1:1 and adds same-repo worktree grouping.",
			cardGroupSidebarMark: "(experimental)",
			cardGroupSidebarNote: "Turn it off to restore the native list if anything breaks; we will switch to the official API as soon as it ships.",
			cardGroupSidebarBusy: "Switching sidebar…",
			"group.ungrouped": "Ungrouped",
			"session.new": "New Session",
			"section.workspaces": "Workspaces",
			"section.sessions": "Sessions",
			"viewOptions.label": "View options",
			"groupBy.label": "Group by",
			"groupBy.workspace": "WorkSpace",
			"groupBy.flat": "In one list",
			"orderBy.label": "Order by",
			"orderBy.manual": "Manual",
			"orderBy.updated": "Last updated",
			"sessions.expand": "Show {n} more sessions",
			"sessions.collapse": "Show less",
			"empty.none": "No sessions yet",
			"empty.noMatches": "No matches",
			"workspace.add": "Add workspace",
			search: "Search",
			"search.sessions.aria": "Search sessions",
			"search.placeholder": "Search sessions...",
			"search.clear": "Clear search",
			"search.results.aria": "Search results",
			"search.pending": "Searching session history…",
			"search.unavailable": "Content search is temporarily unavailable. Showing name matches.",
			"search.noMatches": "No matching sessions",
			"search.hasMore": "Showing the first {n} results. Narrow your search.",
			"menu.addWorkspace": "Add workspace…",
			"picker.loading": "Loading workspaces…",
			"conflict.named": "A workspace named “{name}” already exists.",
			"folderError.title": "Couldn’t open folder",
			"folderError.retry": "Choose again",
			rename: "Rename",
			"rename.workspace.title": "Rename workspace",
			"rename.session.title": "Rename session",
			"field.workspaceName": "Workspace name",
			"field.sessionName": "Session name",
			"delete.workspace": "Delete workspace",
			"delete.desc": "This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
			"delete.pending": "Deleting workspace…",
			"worktreeRemove.menu": "Remove worktree",
			"worktreeRemove.title": "Remove worktree",
			"worktreeRemove.desc": "This removes the worktree from git and deletes the folder “{path}”.",
			"worktreeRemove.descBranch": "The branch {branch} is kept.",
			"worktreeRemove.inspecting": "Inspecting worktree…",
			"worktreeRemove.dirty.one": "{n} uncommitted file will be deleted with the folder.",
			"worktreeRemove.dirty.other": "{n} uncommitted files will be deleted with the folder.",
			"worktreeRemove.clean": "No uncommitted changes.",
			"worktreeRemove.ahead": "{n} commits ahead of upstream, kept on the branch.",
			"worktreeRemove.sessions.one": "{n} session in this workspace will be archived too.",
			"worktreeRemove.sessions.other": "{n} sessions in this workspace will be archived too.",
			"worktreeRemove.busy": "Removing…",
			"stray.unknown": "(unknown directory)",
			"stray.belongsTo": "Stray sessions of “{name}”",
			"stray.missingDir": "Directory no longer exists — registering is unavailable",
			"stray.worktreeSlot": "A worktree storage slot: rebuild this directory (e.g. git worktree add) and its historical sessions reattach automatically",
			"stray.rebuild": "Rebuild empty directory",
			"stray.rebuild.aria": "Rebuild the directory “{name}”",
			"stray.rebuildDone": "Directory rebuilt; its historical sessions will reattach automatically",
			"stray.rebuildFailed": "Rebuild failed: {message}",
			"stray.register": "Register as workspace",
			"stray.register.aria": "Register “{name}” as a workspace",
			"stray.registerFailed": "Registration failed: {message}",
			"menu.fork": "Fork session",
			"menu.archiveSession": "Archive session",
			"sessions.count.one": "{n} session",
			"sessions.count.other": "{n} sessions",
			"actions.workspace.aria": "Workspace actions for {name}",
			"actions.session.aria": "Session actions for {name}",
			"actions.newSession.aria": "New session in {name}",
			"status.running": "Running",
			"status.subagentsRunning.one": "{n} subagent running",
			"status.subagentsRunning.other": "{n} subagents running",
			"status.idle": "Idle",
			"status.waitingApproval": "Waiting for approval",
			"status.planReview": "Plan awaiting review",
			"status.waitingAnswer": "Waiting for answer",
			"status.completed": "Completed",
			"hover.created": "Created {time}",
			"hover.copied": "Copied",
			"date.ymd": "{y}-{m}-{d}",
			"time.now": "now",
			"time.minutes": "{n}min",
			"time.hours": "{n}h",
			"time.days": "{n}d",
			"time.months": "{n}mo",
			"time.years": "{n}y",
			"time.ago": "{t} ago",
			copy: "Copy",
			close: "Close",
			cancel: "Cancel"
		};
		/** 中文词典。 */
		const zh = {
			chipWorktree: "工作树",
			worktreeToggle: "创建隔离工作树",
			menuBranches: "分支",
			menuLocalBranches: "本地分支",
			menuWorktrees: "工作树",
			menuRemoteBranches: "远程分支",
			mainRepoOnly: "分支操作请在主仓库发起",
			menuSearchPlaceholder: "搜索分支",
			menuNoMatches: "没有匹配的分支",
			menuNoBranches: "暂无分支",
			menuLocate: "定位当前分支",
			menuExpandAll: "全部展开",
			menuCollapseAll: "全部折叠",
			menuNewBranch: "从当前分支新建分支",
			menuNewBranchPlaceholder: "新分支名称",
			menuNewBranchBad: "Git 不接受该名称",
			menuNewBranchExists: "同名分支已存在",
			menuFetch: "提取",
			menuUpdate: "更新当前分支",
			fetchDone: "远程分支已同步",
			updateDone: "{branch} 已快进到远程最新",
			updateUpToDate: "已是最新",
			aheadTitle: "领先上游 {n} 个提交",
			behindTitle: "落后上游 {n} 个提交",
			switchAsk: "是否切到 {branch}？",
			switchAskRemote: "是否检出该远程分支？",
			switchBusy: "切换中…",
			worktreeAskNew: "是否从 {branch} 新建工作树？",
			worktreeAskRemote: "从该远程分支新建工作树？",
			worktreeAskReuse: "是否切到 {branch} 工作树？",
			worktreeAskCutOut: "从当前分支 {branch} 切出新分支到隔离工作树",
			worktreeBusy: "创建中…",
			createBranchTitle: "从 {branch} 新建分支",
			createBranchBusy: "创建中…",
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
			cardSaving: "保存中…",
			sidebarSectionTitle: "工作区",
			sidebarAddSession: "发起新会话",
			sidebarNewSession: "新会话",
			sidebarMainBranch: "主仓库（{branch}）",
			sidebarMain: "主仓库",
			sidebarRailExpand: "展开侧栏",
			cardGroupSidebarLabel: "聚合工作区",
			cardGroupSidebarHint: "DSH 尚未开放多工作区聚合接口，因此按原生侧边栏 1:1 替换左侧列表，并加上同仓库工作树分组。",
			cardGroupSidebarMark: "（测试功能）",
			cardGroupSidebarNote: "使用中若遇问题，关掉即可回到原生；官方接口一旦开放，会第一时间改用原生实现。",
			cardGroupSidebarBusy: "正在切换侧栏…",
			"group.ungrouped": "未分组",
			"session.new": "新会话",
			"section.workspaces": "工作区",
			"section.sessions": "会话",
			"viewOptions.label": "视图选项",
			"groupBy.label": "分组方式",
			"groupBy.workspace": "按工作区",
			"groupBy.flat": "单列表",
			"orderBy.label": "排序方式",
			"orderBy.manual": "手动排序",
			"orderBy.updated": "最近更新",
			"sessions.expand": "展开其余 {n} 个会话",
			"sessions.collapse": "收起",
			"empty.none": "暂无会话",
			"empty.noMatches": "无匹配结果",
			"workspace.add": "添加工作区",
			search: "搜索",
			"search.sessions.aria": "搜索会话",
			"search.placeholder": "搜索会话…",
			"search.clear": "清除搜索",
			"search.results.aria": "搜索结果",
			"search.pending": "正在搜索会话历史…",
			"search.unavailable": "内容搜索暂不可用，仅显示名称匹配。",
			"search.noMatches": "无匹配会话",
			"search.hasMore": "仅显示前 {n} 条结果，请缩小搜索范围。",
			"menu.addWorkspace": "添加工作区…",
			"picker.loading": "正在加载工作区…",
			"conflict.named": "已存在名为“{name}”的工作区。",
			"folderError.title": "无法打开文件夹",
			"folderError.retry": "重新选择",
			rename: "重命名",
			"rename.workspace.title": "重命名工作区",
			"rename.session.title": "重命名会话",
			"field.workspaceName": "工作区名称",
			"field.sessionName": "会话名称",
			"delete.workspace": "删除工作区",
			"delete.desc": "将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。",
			"delete.pending": "正在删除工作区…",
			"worktreeRemove.menu": "删除工作树",
			"worktreeRemove.title": "删除工作树",
			"worktreeRemove.desc": "将从 git 移除该工作树并删除目录“{path}”。",
			"worktreeRemove.descBranch": "分支 {branch} 将保留。",
			"worktreeRemove.inspecting": "正在检查工作树…",
			"worktreeRemove.dirty.one": "{n} 个未提交文件将随目录一并删除。",
			"worktreeRemove.dirty.other": "{n} 个未提交文件将随目录一并删除。",
			"worktreeRemove.clean": "无未提交改动。",
			"worktreeRemove.ahead": "分支领先上游 {n} 个提交，提交将保留在分支上。",
			"worktreeRemove.sessions.one": "该工作区下的 {n} 个会话将一并归档。",
			"worktreeRemove.sessions.other": "该工作区下的 {n} 个会话将一并归档。",
			"worktreeRemove.busy": "删除中…",
			"stray.unknown": "（目录未知）",
			"stray.belongsTo": "属于“{name}”的失联会话",
			"stray.missingDir": "目录已不存在，无法注册",
			"stray.worktreeSlot": "工作树存放位：重建此目录（如 git worktree add）后，其历史会话将自动归位",
			"stray.rebuild": "重建空目录",
			"stray.rebuild.aria": "重建目录“{name}”",
			"stray.rebuildDone": "目录已重建，其历史会话将自动归位",
			"stray.rebuildFailed": "重建失败：{message}",
			"stray.register": "注册为工作区",
			"stray.register.aria": "将“{name}”注册为工作区",
			"stray.registerFailed": "注册失败：{message}",
			"menu.fork": "分叉会话",
			"menu.archiveSession": "归档会话",
			"sessions.count.one": "{n} 个会话",
			"sessions.count.other": "{n} 个会话",
			"actions.workspace.aria": "工作区“{name}”的操作",
			"actions.session.aria": "会话“{name}”的操作",
			"actions.newSession.aria": "在“{name}”中新建会话",
			"status.running": "进行中",
			"status.subagentsRunning.one": "{n} 个子代理运行中",
			"status.subagentsRunning.other": "{n} 个子代理运行中",
			"status.idle": "空闲",
			"status.waitingApproval": "等待审批",
			"status.planReview": "计划待审",
			"status.waitingAnswer": "等待回答",
			"status.completed": "已完成",
			"hover.created": "创建于 {time}",
			"hover.copied": "已复制",
			"date.ymd": "{y}年{m}月{d}日",
			"time.now": "刚刚",
			"time.minutes": "{n}分钟",
			"time.hours": "{n}小时",
			"time.days": "{n}天",
			"time.months": "{n}个月",
			"time.years": "{n}年",
			"time.ago": "{t}前",
			copy: "复制",
			close: "关闭",
			cancel: "取消"
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
		/** Required services: the slot ledger, session/workspace runtimes, the
		* workspace navigation/directory face, copy, and the settings scope backing
		* the plugin configuration card. */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"uiWorkspace",
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
			const chipInjected = () => ({
				adoptWorktree: async (path) => {
					const workspace = await ctx.workspaces.create({ path });
					ctx.uiWorkspace.startSession(workspace.workspaceId);
				},
				sessionsList: ctx.sessions.list
			});
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "git-worktree",
				order: 5,
				locale: NS,
				inject: chipInjected
			}, BranchChipDock));
			const groupingScope = ctx.settingsScope.bind({ namespace: GIT_WORKTREE_NS });
			const SEAT_READY_TIMEOUT_MS = 2e4;
			const SNAPSHOT_WAIT_MS = 8e3;
			let groupingDisposer;
			let groupingEnabled;
			let seatEpoch = 0;
			let seatReady = Promise.resolve();
			let seatReadyResolve;
			let seatTimer;
			const finishSeat = () => {
				if (seatTimer !== void 0) {
					window.clearTimeout(seatTimer);
					seatTimer = void 0;
				}
				const resolve = seatReadyResolve;
				seatReadyResolve = void 0;
				resolve?.();
			};
			const afterPaint = () => new Promise((resolve) => {
				if (typeof requestAnimationFrame === "function") {
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							resolve();
						});
					});
					return;
				}
				setTimeout(resolve, 0);
			});
			const groupingMatches = (enabled) => {
				const snapshot = groupingScope.getSnapshot();
				return snapshot.status === "ready" && (snapshot.value?.groupSidebar ?? true) === enabled;
			};
			const waitSnapshotMatches = async (enabled) => {
				if (groupingMatches(enabled)) return;
				await new Promise((resolve) => {
					const stop = groupingScope.subscribe(() => {
						if (!groupingMatches(enabled)) return;
						stop();
						window.clearTimeout(timer);
						resolve();
					});
					const timer = window.setTimeout(() => {
						stop();
						resolve();
					}, SNAPSHOT_WAIT_MS);
					if (groupingMatches(enabled)) {
						window.clearTimeout(timer);
						stop();
						resolve();
					}
				});
			};
			const syncGroupingSeat = () => {
				const snapshot = groupingScope.getSnapshot();
				if (snapshot.status !== "ready") return seatReady;
				const enabled = snapshot.value?.groupSidebar ?? true;
				if (enabled === groupingEnabled) return seatReady;
				groupingEnabled = enabled;
				if (groupingDisposer !== void 0) {
					groupingDisposer();
					groupingDisposer = void 0;
				}
				const epoch = ++seatEpoch;
				seatReady = new Promise((resolve) => {
					seatReadyResolve = resolve;
				});
				if (!enabled) {
					afterPaint().then(() => {
						if (epoch === seatEpoch) finishSeat();
					});
					return seatReady;
				}
				const injectFace = () => ({
					workspacesList: ctx.workspaces.list,
					sessionsList: ctx.sessions.list,
					openSession: (sessionId) => {
						ctx.sessions.open(sessionId);
					},
					startSession: (workspaceId) => {
						ctx.uiWorkspace.startSession(workspaceId);
					},
					loadFacts: async (paths) => {
						const result = await requestGroupWorktrees(paths);
						return result.ok ? result.facts : void 0;
					},
					searchSessions: async (query, signal) => {
						const result = await ctx.sessions.search(query, signal);
						if (!result.ok) throw new Error(result.error.message);
						return result.value;
					},
					searchResultLimit: ctx.sessions.searchResultLimit,
					renameSession: async (sessionId, title) => {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === void 0) throw new Error(`unknown session "${sessionId}"`);
						const result = await session.rename(title);
						if (!result.ok) throw new Error(result.error.message);
					},
					forkSession: (sessionId) => {
						ctx.sessions.fork({
							sessionId,
							increaseTitle: true
						}).then((childId) => {
							ctx.sessions.open(childId);
						}).catch(() => {});
					},
					renameWorkspace: async (workspaceId, title) => {
						await ctx.workspaces.rename(workspaceId, title);
					},
					deleteWorkspace: async (workspaceId) => {
						await ctx.workspaces.delete(workspaceId);
					},
					archiveSession: async (sessionId) => {
						await ctx.workspaces.archiveSession(sessionId);
					},
					inspectWorktree: async (path) => {
						const result = await requestInspectWorktree(path);
						if (!result.ok) throw new Error(result.error);
						return {
							dirty: result.dirty,
							ahead: result.ahead
						};
					},
					removeWorktree: async (path, force) => {
						const result = await requestRemoveWorktree(path, force);
						if (!result.ok) throw new Error(result.error);
					},
					probeDirectories: async (paths) => {
						const result = await requestPathExists(paths);
						return result.ok ? {
							exists: result.exists,
							...result.rebuildable === void 0 ? {} : { rebuildable: result.rebuildable }
						} : void 0;
					},
					ensureDirectory: async (path) => {
						const result = await requestEnsureDirectory(path);
						if (!result.ok) throw new Error(result.error);
					},
					createWorkspace: (input) => ctx.workspaces.create(input),
					pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
					hostInfo: (() => {
						const generation = ctx.get("connection").generation;
						return {
							getSnapshot: () => ctx.remote.$host,
							subscribe: (listener) => generation.subscribe(listener)
						};
					})(),
					directoryFlow: {
						getSnapshot: () => ctx.slots.entries("sidebar.workspaces.directoryFlow").length > 0,
						subscribe: (listener) => ctx.slots.subscribe("sidebar.workspaces.directoryFlow", listener)
					},
					onReady: () => {
						if (epoch === seatEpoch) finishSeat();
					}
				});
				groupingDisposer = ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
					name: "sidebar.workspaces",
					priority: -1,
					locale: NS,
					inject: injectFace
				}, GroupedSidebar));
				seatTimer = window.setTimeout(() => {
					if (epoch === seatEpoch) finishSeat();
				}, SEAT_READY_TIMEOUT_MS);
				return seatReady;
			};
			const waitForGroupingSeat = async (enabled) => {
				await waitSnapshotMatches(enabled);
				await syncGroupingSeat();
			};
			const form = new CardForm(groupingScope, waitForGroupingSeat);
			const store = form.bind();
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: GIT_WORKTREE_NS,
				priority: -1,
				locale: NS,
				inject: () => ({
					hooks: { gitWorktreeCard: store },
					...form.actions(),
					pickDirectory: () => ctx.uiWorkspace.pickDirectory()
				})
			}, GitWorktreeCard));
			syncGroupingSeat();
			const unsubscribeGrouping = groupingScope.subscribe(() => {
				syncGroupingSeat();
			});
			ctx.effect(() => () => {
				unsubscribeGrouping();
				if (groupingDisposer !== void 0) groupingDisposer();
			}, "git-worktree: sidebar grouping lifecycle");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map