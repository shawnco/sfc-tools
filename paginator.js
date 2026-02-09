// ==UserScript==
// @name         SFC Threads Paginator
// @namespace    https://github.com/shawnco/sfc-threads
// @version      0.1.0
// @description  Paginate forum threads on playstarfleet.com: auto-open 'See all' and add Prev/Next controls.
// @author       Shawn Contant
// @match        *://playstarfleet.com/topics/show/*
// @match        *://*.playstarfleet.com/topics/show/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/**
 * sfc-threads paginator
 * - Auto-clicks the "See all [x] posts..." link if present
 * - Waits for additional posts to load
 * - Paginates the posts table (#posts) into pages of 10 posts with Prev/Next controls
 *
 * Designed to be safe to run in the page (userscript or injected). Uses no external libs.
 */

(function () {
	if (window.__sfcPaginatorInitialized) return;
	window.__sfcPaginatorInitialized = true;

	const POSTS_PER_PAGE = 10;

	function log(...args) {
		if (window.console && console.log) console.log('[sfc-paginator]', ...args);
	}

	function findSeeAllLink(postsTable) {
		if (!postsTable) return null;
		// look for an <a> whose text matches "See all X posts" or whose onclick calls showAllPosts
		const anchors = postsTable.querySelectorAll('a');
		for (const a of anchors) {
			const text = (a.textContent || '').trim();
			if (/See all \d+ posts/i.test(text)) return a;
			const onclick = a.getAttribute('onclick') || '';
			if (/showAllPosts\s*\(/.test(onclick)) return a;
		}
		return null;
	}

	function collectBlocks(postsTable) {
		// Each logical post may include a preceding 'space' tr then a 'post' tr.
		// We'll iterate tr children and group them into blocks where a 'post' row starts a block.
		const trs = Array.from(postsTable.querySelectorAll(':scope > tbody > tr, :scope > tr'));
		const blocks = [];
		for (let i = 0; i < trs.length; i++) {
			const tr = trs[i];
			const cls = (tr.className || '');
			if (/\bpost\b/.test(cls)) {
				// include preceding space row if present
				const block = [];
				const prev = trs[i - 1];
				if (prev && /\bspace\b/.test(prev.className || '')) block.push(prev);
				block.push(tr);
				blocks.push(block);
			}
		}
		return blocks;
	}

	function showBlocks(blocks, pageIndex) {
		const start = pageIndex * POSTS_PER_PAGE;
		const end = start + POSTS_PER_PAGE;
		for (let i = 0; i < blocks.length; i++) {
			const visible = i >= start && i < end;
			for (const tr of blocks[i]) {
				tr.style.display = visible ? '' : 'none';
			}
		}
	}

	function createControls(container, totalPages, onPage) {
		// remove existing controls if present
		const existing = document.getElementById('sfc-paginator-controls');
		if (existing) existing.remove();

		const wrapper = document.createElement('div');
		wrapper.id = 'sfc-paginator-controls';
		wrapper.style.margin = '8px 0';
		wrapper.style.fontFamily = 'sans-serif';

		const prev = document.createElement('button');
		prev.textContent = '← Previous';
		prev.style.marginRight = '8px';
		prev.disabled = true;

		const next = document.createElement('button');
		next.textContent = 'Next →';
		next.style.marginLeft = '8px';

		const indicator = document.createElement('span');
		indicator.style.margin = '0 8px';
		indicator.textContent = `Page 1 of ${totalPages}`;

		let current = 0;

		function updateButtons() {
			prev.disabled = current <= 0;
			next.disabled = current >= totalPages - 1;
			indicator.textContent = `Page ${current + 1} of ${totalPages}`;
			onPage(current);
		}

		prev.addEventListener('click', () => {
			if (current > 0) { current--; updateButtons(); }
		});
		next.addEventListener('click', () => {
			if (current < totalPages - 1) { current++; updateButtons(); }
		});

		wrapper.appendChild(prev);
		wrapper.appendChild(indicator);
		wrapper.appendChild(next);

		container.parentNode.insertBefore(wrapper, container);
		return { setPage: (n) => { current = Math.max(0, Math.min(totalPages - 1, n)); updateButtons(); } };
	}

	function paginate(postsTable) {
		const blocks = collectBlocks(postsTable);
		if (!blocks.length) {
			log('no post blocks found — nothing to paginate');
			return;
		}
		if (blocks.length <= POSTS_PER_PAGE) {
			log('post count <= page size — skipping pagination');
			return;
		}

			const totalPages = Math.ceil(blocks.length / POSTS_PER_PAGE);
			const controls = createControls(postsTable, totalPages, (page) => showBlocks(blocks, page));
			// jump to last page by default and scroll to the last post
			controls.setPage(totalPages - 1);
			// allow DOM to update, then scroll the last visible post into view
			setTimeout(() => {
				const visiblePosts = Array.from(postsTable.querySelectorAll('tr.post')).filter(tr => tr.style.display !== 'none');
				if (visiblePosts.length) {
					const lastTr = visiblePosts[visiblePosts.length - 1];
					try { lastTr.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { lastTr.scrollIntoView(); }
				}
			}, 50);
	}

	function waitForPostsToStabilize(postsTable, timeout = 5000) {
		return new Promise((resolve) => {
			const start = Date.now();
			let lastCount = (postsTable.querySelectorAll('tr.post') || []).length;
			let stableSince = Date.now();

			const mo = new MutationObserver(() => {
				const nowCount = (postsTable.querySelectorAll('tr.post') || []).length;
				if (nowCount !== lastCount) {
					lastCount = nowCount;
					stableSince = Date.now();
				}
			});
			mo.observe(postsTable, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

			const check = () => {
				if (Date.now() - stableSince > 300) {
					mo.disconnect();
					resolve();
				} else if (Date.now() - start > timeout) {
					mo.disconnect();
					resolve();
				} else {
					setTimeout(check, 100);
				}
			};
			check();
		});
	}

	function init() {
		const postsTable = document.getElementById('posts');
		if (!postsTable) { log('no #posts table found on page'); return; }

		const seeAll = findSeeAllLink(postsTable);
		const runPagination = async () => {
			await waitForPostsToStabilize(postsTable);
			paginate(postsTable);
		};

		if (seeAll) {
			log('See all link found — triggering it and waiting for posts to load');
			// Try to trigger the link safely.
			try {
				// call click; if onclick returns false the link may do nothing — but example uses showAllPosts();
				seeAll.click();
			} catch (e) {
				try { (seeAll.getAttribute('onclick') || '').replace(/;?\s*return false;?$/, ''); } catch (e2) {}
			}
			// wait for additional posts then paginate
			runPagination();
		} else {
			// no seeAll — paginate current posts
			runPagination();
		}
	}

	if (document.readyState === 'complete' || document.readyState === 'interactive') {
		setTimeout(init, 0);
	} else {
		document.addEventListener('DOMContentLoaded', init);
	}

})();