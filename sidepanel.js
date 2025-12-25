/**
 * ZenTree Tabs - Side Panel Logic
 * Handles tab rendering, tree structure, events, and drag-and-drop.
 */

// --- State ---
let tabsMap = new Map(); // tabId -> tab object
let rootTabs = []; // Array of tabIds that are roots

let collapsedState = new Set(); // Set of tabIds whose children are hidden
let parentOverrides = new Map(); // childId -> parentId
let customTitles = new Map(); // tabId -> String
let pendingScrollTabId = null;

const tabsListEl = document.getElementById('tabs-list');
const searchInput = document.getElementById('tab-search');
const newTabBtn = document.getElementById('new-tab-btn');

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadCollapsedState();
        await loadParentOverrides();
        await loadCustomTitles();
        await fetchAndRenderTabs();
        if (chrome.bookmarks) {
            await fetchAndRenderBookmarks();
        }
    } catch (err) {
        console.error("ZenTree Init Error:", err);
        document.body.innerHTML = `<div style="padding:20px; color:red;">Error loading ZenTree:<br>${err.message}</div>`;
    }

    // Key Tab Listeners
    chrome.tabs.onCreated.addListener(onTabCreated);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.tabs.onMoved.addListener(onTabMoved);

    // UI Listeners
    newTabBtn.addEventListener('click', () => chrome.tabs.create({}));
    searchInput.addEventListener('input', handleSearch);

    // Settings Modal Logic
    const settingsModal = document.getElementById('settings-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings');
    const toggleMesh = document.getElementById('toggle-mesh');
    const toggleGlass = document.getElementById('toggle-glass');

    // Helper to update UI state of toggles
    const updateToggleState = (meshEnabled) => {
        if (!toggleGlass) return;
        const row = toggleGlass.closest('.setting-row');
        if (meshEnabled) {
            row.classList.remove('disabled');
            toggleGlass.disabled = false;
        } else {
            row.classList.add('disabled');
            toggleGlass.disabled = true;
        }
    };

    // Theme Selector Logic
    const themeSwatches = document.querySelectorAll('.theme-swatch');

    // Helper to update active swatch UI
    const updateActiveSwatch = (activeTheme) => {
        themeSwatches.forEach(swatch => {
            if (swatch.dataset.theme === activeTheme) {
                swatch.classList.add('active');
            } else {
                swatch.classList.remove('active');
            }
        });
    };

    if (themeSwatches.length > 0) {
        themeSwatches.forEach(swatch => {
            swatch.addEventListener('click', () => {
                const theme = swatch.dataset.theme;
                updateActiveSwatch(theme);
                updateThemeSettings({ themeColor: theme });
            });
        });
    }

    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            // Sync UI state before showing
            chrome.storage.local.get({ themeSettings: { bgMesh: true, tabGlass: true, themeColor: 'default' } }, (res) => {
                const settings = res.themeSettings;
                if (toggleMesh) {
                    toggleMesh.checked = settings.bgMesh;
                    // Initial dependency check
                    updateToggleState(settings.bgMesh);
                }
                if (toggleGlass) toggleGlass.checked = settings.tabGlass;

                // Sync Theme Swatch
                updateActiveSwatch(settings.themeColor);

                settingsModal.classList.remove('hidden');
            });
        });
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }

    // Close on backdrop click
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }

    // Toggle Listeners
    if (toggleMesh) {
        toggleMesh.addEventListener('change', () => {
            const isEnabled = toggleMesh.checked;
            updateToggleState(isEnabled);
            updateThemeSettings({ bgMesh: isEnabled });
        });
    }
    if (toggleGlass) {
        toggleGlass.addEventListener('change', () => {
            updateThemeSettings({ tabGlass: toggleGlass.checked });
        });
    }

    // Theme Logic
    await applyTheme();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.themeSettings) {
            applyTheme();
        }
    });
});

async function updateThemeSettings(partialSettings) {
    const res = await chrome.storage.local.get({ themeSettings: { bgMesh: true, tabGlass: true } });
    const newSettings = { ...res.themeSettings, ...partialSettings };
    await chrome.storage.local.set({ themeSettings: newSettings });
}

async function applyTheme() {
    const res = await chrome.storage.local.get({ themeSettings: { bgMesh: true, tabGlass: true } });
    const settings = res.themeSettings;

    // 1. Background Mesh (Master Switch)
    if (!settings.bgMesh) {
        document.body.classList.add('no-mesh');
        // Logic Requirement: If Master is OFF, Tabs must be FLAT (simulating "Glass Off").
        // We override the visual state here regardless of the saved tabGlass setting.
        document.body.classList.add('flat-tabs');
    } else {
        document.body.classList.remove('no-mesh');

        // 2. Tab Glass (Only respected if Mesh is ON)
        if (!settings.tabGlass) {
            document.body.classList.add('flat-tabs');
        } else {
            document.body.classList.remove('flat-tabs');
        }
    }

    // 3. Color Theme
    document.body.classList.remove('theme-sunset', 'theme-forest', 'theme-berry', 'theme-monochrome');

    if (settings.themeColor && settings.themeColor !== 'default') {
        document.body.classList.add(`theme-${settings.themeColor}`);
    }

    // Legacy cleanup (remove simple-theme if it persisted)
    document.body.classList.remove('simple-theme');
}

// --- Core Data Fetching ---

async function fetchAndRenderTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });

    // Fetch all groups in current window
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const groupsMap = new Map();
    groups.forEach(g => groupsMap.set(g.id, g));

    buildTree(tabs, groupsMap);
    renderTree(groupsMap);
}

/**
 * Builds the tree structure from a flat list of tabs.
 * Uses openerTabId to determine hierarchy.
 */
/**
 * Builds the tree structure.
 * Structure:
 * - rootTabs (Tabs with no parent AND no group)
 * - groupBuckets (Map<groupId, Array<tabId>>) -> Logic: Group acts as a root, Tree inside Group.
 */
let groupBuckets = new Map(); // groupId -> Array<rootTabIds inside group>

function buildTree(tabs, groupsMap) {
    tabsMap.clear();
    groupBuckets.clear();
    rootTabs = [];

    // Initialize buckets for known groups
    for (const groupId of groupsMap.keys()) {
        groupBuckets.set(groupId, []);
    }

    // First pass: Index tabs
    tabs.forEach(tab => tabsMap.set(tab.id, { ...tab, children: [] }));

    // Second pass: Build parent-child relationships
    // Note: If a child is in a different group than parent, visual hierarchy breaks visually.
    // For specific requirement: "Grouped" tabs show in panel.
    // We will enforce: If in a Group, display in that Group.
    // Inside the group, we try to nesting if standard logic applies AND both are in same group.

    tabs.forEach(tab => {
        const inGroup = tab.groupId !== -1;

        const effectiveUrl = tab.pendingUrl || tab.url;
        const isNewTab = (effectiveUrl === 'chrome://newtab/' || effectiveUrl === 'edge://newtab/');

        // If it implies a fresh start, we force it to be a root forever by saving an override
        // We use -1 to signify "Explicitly Root"
        if (isNewTab && !parentOverrides.has(tab.id)) {
            // We can't await here, so we just set in memory and fire-and-forget save
            // Realistically, we should do this in an event listener, but doing it here ensures it catches state immediately.
            parentOverrides.set(tab.id, -1);
            saveParentOverrides(); // Helper function we will add/ensure exists
        }

        let parentId = parentOverrides.get(tab.id);

        // If no override, use opener. If override is -1, treat as null (root).
        if (parentId === undefined) {
            parentId = tab.openerTabId;
        } else if (parentId === -1) {
            parentId = null;
        }
        let placed = false;

        // Try to nest under a parent
        if (parentId && tabsMap.has(parentId)) {
            const parent = tabsMap.get(parentId);

            // Allow nesting ONLY if:
            // 1. Both are in SAME group
            // 2. OR Both are NOT in a group
            // If they are split across groups, we don't nest visually to avoid confused UI.
            if (parent.groupId === tab.groupId) {
                // Basic cycle prevention
                const parentsParentId = parentOverrides.get(parentId) || parent.openerTabId;
                if (parentsParentId !== tab.id) {
                    parent.children.push(tab.id);
                    placed = true;
                }
            }
        }

        if (!placed) {
            // Is it in a group?
            if (inGroup) {
                if (!groupBuckets.has(tab.groupId)) {
                    groupBuckets.set(tab.groupId, []); // Should exist from init but just in case
                }
                groupBuckets.get(tab.groupId).push(tab.id);
            } else {
                // Root of the main list
                rootTabs.push(tab.id);
            }
        }
    });

    // Sort roots & buckets
    const sortFn = (a, b) => tabsMap.get(a).index - tabsMap.get(b).index;
    rootTabs.sort(sortFn);

    for (const [gid, roots] of groupBuckets) {
        roots.sort(sortFn);
    }
}


// --- Rendering ---

// --- Rendering ---

function renderTree(groupsMap) {
    tabsListEl.innerHTML = '';

    // Filtered mode? (If searching)
    const filterText = searchInput ? searchInput.value : '';
    if (filterText) {
        renderFilteredList(filterText);
        return;
    }

    // 1. We need to respect the visual order of items (Groups vs Tabs mixed)
    // Chrome tabs have an 'index'. Groups don't have a single index, but they span a range.
    // For simplicity: We can iterate through 'Root Tabs' and 'Groups' by finding their min-index.

    const elements = [];

    // Add individual Root Tabs
    rootTabs.forEach(tabId => {
        elements.push({
            type: 'tab',
            index: tabsMap.get(tabId).index,
            id: tabId
        });
    });

    // Add Groups
    if (groupsMap) {
        for (const [groupId, group] of groupsMap) {
            // Use the group's first tab index effectively? 
            // Chrome.tabGroups doesn't give 'index'. It relies on tabs.
            // We can assume group connects to its tabs.
            // We take the index of the first tab in the bucket (if any)
            const bucket = groupBuckets.get(groupId);
            if (bucket && bucket.length > 0) {
                const firstTab = tabsMap.get(bucket[0]);
                elements.push({
                    type: 'group',
                    index: firstTab ? firstTab.index : 9999, // Fallback
                    id: groupId,
                    group: group,
                    children: bucket
                });
            }
        }
    }

    // Sort all by visual index
    elements.sort((a, b) => a.index - b.index);

    // Render
    elements.forEach(el => {
        if (el.type === 'tab') {
            tabsListEl.appendChild(createTabNode(el.id));
        } else {
            tabsListEl.appendChild(createGroupNode(el.group, el.children));
        }
    });

    // Auto-scroll logic
    // Priority: Explicit pending scroll (New Tab) > Active Tab
    if (pendingScrollTabId) {
        const newTabNode = tabsListEl.querySelector(`.tab-tree-node[data-tab-id="${pendingScrollTabId}"]`);
        if (newTabNode) {
            const row = newTabNode.querySelector('.tab-item');
            if (row) {
                setTimeout(() => {
                    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 10);
            }
        }
        pendingScrollTabId = null;
    } else {
        // Fallback: Auto-scroll to active tab
        const activeTabEl = tabsListEl.querySelector('.tab-item.active');
        if (activeTabEl) {
            setTimeout(() => {
                activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 10);
        }
    }
}

function createGroupNode(group, bucketTabIds) {
    const container = document.createElement('div');
    container.className = 'group-node';

    // Header
    const header = document.createElement('div');
    header.className = 'group-header';
    header.style.setProperty('--group-color', mapColor(group.color));

    // Click to Toggle Native Group
    header.addEventListener('click', async () => {
        try {
            await chrome.tabGroups.update(group.id, { collapsed: !group.collapsed });
            // The listener onUpdated will re-render
        } catch (e) {
            console.error("Failed to toggle group", e);
        }
    });

    // --- Drop Target for Groups ---
    // Allow dragging a tab INTO this group header/container
    header.addEventListener('dragover', (e) => {
        e.preventDefault(); // Essential to allow dropping
        header.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    });

    header.addEventListener('dragleave', (e) => {
        header.classList.remove('drag-over');
    });

    header.addEventListener('drop', async (e) => {
        e.preventDefault();
        header.classList.remove('drag-over');

        if (draggedTabId) {
            try {
                // Group the dragged tab into this group
                // Note: This effectively "moves" it to the group visually.
                await chrome.tabs.group({
                    tabIds: [draggedTabId],
                    groupId: group.id
                });
            } catch (err) {
                console.error("Failed to add tab to group:", err);
            }
        }
    });

    // Expand Arrow
    const arrow = document.createElement('div');
    arrow.className = `expand-arrow ${group.collapsed ? '' : 'rotated'}`; // rotated = expanded
    arrow.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    header.appendChild(arrow);

    // Colors dot or line
    const dot = document.createElement('div');
    dot.className = 'group-dot';
    header.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'group-title';
    title.textContent = group.title || 'Untitled Group';
    header.appendChild(title);

    container.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = `group-body ${group.collapsed ? 'collapsed' : ''}`;

    // Optimization: If collapsed, maybe don't even create children DOM?
    // For now, simple display:none via class is fine for performance unless 1000s of tabs.
    if (!group.collapsed) {
        bucketTabIds.forEach(tabId => {
            body.appendChild(createTabNode(tabId, 1)); // Start at depth 1 inside group
        });
    }

    container.appendChild(body);
    return container;
}

function mapColor(chromeColor) {
    const colors = {
        grey: '#bdc1c6',
        blue: '#8ab4f8',
        red: '#f28b82',
        yellow: '#fdd663',
        green: '#81c995',
        pink: '#ff8bcb',
        purple: '#c58af9',
        cyan: '#78d9ec',
        orange: '#fcad70'
    };
    return colors[chromeColor] || '#bdc1c6';
}

function createTabNode(tabId, depth = 0) {
    const tab = tabsMap.get(tabId);
    if (!tab) return document.createElement('div');

    const container = document.createElement('div');
    container.className = 'tab-tree-node';
    container.dataset.tabId = tabId;

    // 1. Remote Tab Item (The visible row)
    const hasChildren = tab.children && tab.children.length > 0;
    const row = document.createElement('div');
    row.className = `tab-item ${tab.active ? 'active' : ''} ${hasChildren ? 'group-root' : ''}`;
    row.draggable = true;

    // Indentation Logic (10px base padding + 16px per depth level)
    row.style.paddingLeft = (10 + (depth * 16)) + 'px';

    // Drag Events
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('drop', handleDrop);
    row.addEventListener('dragend', handleDragEnd);
    row.addEventListener('click', (e) => {
        chrome.tabs.update(tabId, { active: true });
    });

    // Middle Click to Close
    row.addEventListener('auxclick', (e) => {
        if (e.button === 1) { // Middle Mouse Button
            e.stopPropagation(); // Prevent other actions
            e.preventDefault();  // Prevent default scrolling usually associated with middle click
            chrome.tabs.remove(tabId);
        }
    });

    // 2. Expand/Collapse Arrow
    const arrow = document.createElement('div');
    arrow.className = `expand-arrow ${hasChildren ? '' : 'hidden'}`;
    // Initialize rotation based on collapsed state
    const isCollapsed = collapsedState.has(tabId);
    if (!isCollapsed && hasChildren) {
        arrow.classList.add('rotated'); // Rotated means expanded (down)
    }

    arrow.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse(tabId);
    });
    row.appendChild(arrow);

    // 3. Favicon
    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = getFaviconUrl(tab);
    favicon.onerror = () => { favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="%23ccc"><rect width="16" height="16" rx="2"/></svg>'; };
    row.appendChild(favicon);

    // 4. Title
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = customTitles.get(tabId) || tab.title;
    title.title = "Double-click to rename"; // Tooltip hint

    // Rename Logic
    title.ondblclick = (e) => {
        e.stopPropagation();
        const currentName = title.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'rename-input';

        const commit = async () => {
            if (input.value && input.value !== tab.title) {
                customTitles.set(tabId, input.value);
            } else {
                customTitles.delete(tabId); // Revert to original if empty or same
            }
            await saveCustomTitles();
            fetchAndRenderTabs();
        };

        input.onblur = commit;
        input.onkeydown = (ev) => {
            if (ev.key === 'Enter') {
                input.blur();
            }
            if (ev.key === 'Escape') {
                fetchAndRenderTabs(); // Cancel
            }
        };

        title.replaceWith(input);
        input.focus();
        input.select();
    };

    row.appendChild(title);

    // 5. Close Button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent activation
        chrome.tabs.remove(tabId);
    });
    row.appendChild(closeBtn);

    container.appendChild(row);

    // 6. Children Container
    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = `tab-children ${isCollapsed ? 'collapsed' : ''}`;

        tab.children.forEach(childId => {
            const childNode = createTabNode(childId, depth + 1);
            childrenContainer.appendChild(childNode);
        });
        container.appendChild(childrenContainer);
    }

    return container;
}

function renderFilteredList(text) {
    const term = text.toLowerCase();
    for (let [id, tab] of tabsMap) {
        if (tab.title.toLowerCase().includes(term) || tab.url.toLowerCase().includes(term)) {
            // Render simplified node (no children/indentation for search results)
            // Or render logic to show path. For simplicity, flat list:
            const row = createTabNode(id); // Reusing usage, but children might look weird
            // To properly handle flat search, we might hide children styling
            tabsListEl.appendChild(row);
        }
    }
}

// --- Logic ---

async function toggleCollapse(tabId) {
    if (collapsedState.has(tabId)) {
        collapsedState.delete(tabId);
    } else {
        collapsedState.add(tabId);
    }
    await saveCollapsedState();
    fetchAndRenderTabs(); // Re-render to update UI
}

function handleSearch(e) {
    const val = e.target.value;
    renderTree(val);
}

// --- Event Handlers ---
// For group updates
chrome.tabGroups.onUpdated.addListener(scheduleRender);
chrome.tabGroups.onCreated.addListener(scheduleRender);
chrome.tabGroups.onRemoved.addListener(scheduleRender);
chrome.tabGroups.onMoved.addListener(scheduleRender);

// Debounce rendering to avoid flickering on rapid updates
let renderTimeout;
function scheduleRender() {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        fetchAndRenderTabs();
    }, 50); // Small buffer
}

function onTabCreated(tab) {
    pendingScrollTabId = tab.id;
    scheduleRender();
}
function onTabRemoved() { scheduleRender(); }
function onTabMoved() { scheduleRender(); }

function onTabActivated(activeInfo) {
    // Optimization: Don't re-render whole tree, just update class
    const prevActive = document.querySelector('.tab-item.active');
    if (prevActive) prevActive.classList.remove('active');

    const newActiveContainer = document.querySelector(`.tab-tree-node[data-tab-id="${activeInfo.tabId}"]`);
    if (newActiveContainer) {
        const newActive = newActiveContainer.querySelector('.tab-item');
        if (newActive) {
            newActive.classList.add('active');
            // Smooth scroll to view
            setTimeout(() => {
                newActive.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 10);
        }
    } else {
        // Fallback if not found (e.g. new window or not rendered yet)
        scheduleRender();
    }
}

function onTabUpdated(tabId, changeInfo, tab) {
    // Optimization: Update specific fields directly in DOM
    const container = document.querySelector(`.tab-tree-node[data-tab-id="${tabId}"]`);
    if (!container) {
        // Tab not in DOM? structural change or new tab?
        return scheduleRender();
    }

    if (changeInfo.status === 'loading') {
        // Optional: Set favicon to spinner?
        // For now, we can just ensure we re-fetch favicon if it changes
    }

    // Title Change
    if (changeInfo.title) {
        const titleEl = container.querySelector('.tab-title');
        // Only update if not custom title (or if we want to sync)
        if (titleEl && !customTitles.has(tabId)) {
            titleEl.textContent = changeInfo.title;
        }
    }

    // Favicon Change
    if (changeInfo.favIconUrl) {
        const faviconEl = container.querySelector('.tab-favicon');
        if (faviconEl) {
            faviconEl.src = getFaviconUrl(tab);
        }
    }

    // Pinned status or Group change usually requires re-sort/re-structure
    if (changeInfo.pinned !== undefined || changeInfo.groupId !== undefined) {
        scheduleRender();
    }
}

// --- Persistence ---

async function loadCollapsedState() {
    const res = await chrome.storage.local.get('collapsedState');
    if (res.collapsedState) {
        collapsedState = new Set(res.collapsedState);
    }
}

async function saveCollapsedState() {
    await chrome.storage.local.set({
        collapsedState: Array.from(collapsedState)
    });
}

async function loadCustomTitles() {
    const res = await chrome.storage.local.get('customTitles');
    if (res.customTitles) {
        // Convert object back to map. Keys stored as strings in JSON.
        customTitles = new Map(Object.entries(res.customTitles).map(([k, v]) => [Number(k), v]));
    }
}

async function saveCustomTitles() {
    await chrome.storage.local.set({
        customTitles: Object.fromEntries(customTitles)
    });
}

async function saveCustomTitles() {
    await chrome.storage.local.set({
        customTitles: Object.fromEntries(customTitles)
    });
}

// --- Icon Logic ---

function getFaviconUrl(tab) {
    // 1. Handle chrome:// and edge:// internal pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
        const url = new URL(tab.url);
        const hostname = url.hostname;

        // Common System Icons (SVG Data URIs)
        const icons = {
            'settings': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%235f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>', // Gear
            'extensions': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%235f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 6c-2.6 0-2.7-4-5.8-4s-3.2 4-5.8 4c0 2.6-4 2.7-4 5.8s4 3.2 4 5.8c2.6 0 2.7 4 5.8 4s3.2-4 5.8-4c0-2.6 4-2.7 4-5.8s-4-3.2-4-5.8z"></path></svg>', // Puzzle
            'history': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%235f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>', // Clock
            'downloads': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%235f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>', // Arrow Down
            'newtab': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%235f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>' // Plus (but usually overridden by extension)
        };

        if (icons[hostname]) {
            return icons[hostname];
        }

        // Default Chrome Logo (Simplified Colorful Circle)
        return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="%235f6368" stroke-width="2"/></svg>';
    }

    // 2. Use Chrome's cached favicon service (Robust for extensions and standard sites)
    // This requires 'favicon' permission in manifest.
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", tab.url);
    url.searchParams.set("size", "32");
    return url.toString();
}

// --- Drag & Drop (Native HTML5) ---

let draggedTabId = null;

function handleDragStart(e) {
    draggedTabId = Number(this.parentNode.dataset.tabId); // parentNode is .tab-tree-node
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';

    // Optional: Set drag image to something cleaner if desired
}

function handleDragOver(e) {
    e.preventDefault(); // Essential to allow dropping
    e.dataTransfer.dropEffect = 'move';

    const targetTabId = Number(this.parentNode.dataset.tabId);
    if (!draggedTabId || targetTabId === draggedTabId) return;

    // Calculate Drop Zone
    const rect = this.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    // Thresholds: Top 25%, Middle 50%, Bottom 25%
    const zoneTop = height * 0.25;
    const zoneBottom = height * 0.75;

    // Clear previous classes
    this.classList.remove('drop-above', 'drop-inside', 'drop-below');

    if (y < zoneTop) {
        this.classList.add('drop-above');
    } else if (y > zoneBottom) {
        this.classList.add('drop-below');
    } else {
        this.classList.add('drop-inside');
    }
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.tab-item').forEach(el => {
        el.classList.remove('drag-over', 'drop-above', 'drop-inside', 'drop-below');
    });
    draggedTabId = null;
}

async function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault(); // Stop browser redirect

    const targetTabId = Number(this.parentNode.dataset.tabId);

    // Cleanup visuals
    this.classList.remove('drag-over', 'drop-above', 'drop-inside', 'drop-below');

    if (!draggedTabId || !targetTabId || draggedTabId === targetTabId) return;

    // Determine Action based on mouse position (same logic as DragOver)
    const rect = this.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    const zoneTop = height * 0.25;
    const zoneBottom = height * 0.75;

    let action = 'nest'; // default
    if (y < zoneTop) action = 'before';
    else if (y > zoneBottom) action = 'after';

    await moveTabTree(draggedTabId, targetTabId, action);
}

// --- Tree Move Logic ---

async function moveTabTree(sourceId, targetId, action) {
    // 1. Get entire subtree of source
    const movingIds = getSubtree(sourceId);

    // Prevent moving a parent into its own child (cycle)
    if (movingIds.includes(targetId)) {
        console.warn("Cannot move parent into its own child");
        return;
    }

    // 2. Determine new Parent and new Index
    await loadParentOverrides(); // Sync latest state

    let newParentId = null;
    let targetIndex = -1;

    const targetTab = tabsMap.get(targetId);
    if (!targetTab) return;

    if (action === 'nest') {
        // A becomes child of B
        newParentId = targetId;

        // Append to the end of B's children
        // We need to find the flat index of the LAST descendant of B
        const targetSubtree = getSubtree(targetId);
        const lastDescendantId = targetSubtree[targetSubtree.length - 1];
        const lastDescendant = tabsMap.get(lastDescendantId);

        // Target index is after the last descendant
        targetIndex = lastDescendant.index + 1;

        // Determine offset: if we are moving DOWN, the target index logic works.
        // If we are moving UP, indices shift. Chrome.tabs.move handles the shift if "index" is used correctly
        // relative to CURRENT layout. 
        // Note: references to 'index' are from BEFORE the move.
        // If source is BEFORE target, moving it effectively subtracts from target's index.
        // Safer to just say: "Place it at X".

    } else if (action === 'before') {
        // A becomes sibling of B, placed immediately before B

        // Parent is same as B's parent
        const parentOfTarget = parentOverrides.get(targetId);
        // If undefined, check internal map or assume root (null if explicitly -1 or missing)
        // We can just rely on what our 'buildTree' logic thinks B's parent is.
        // BUT logic needs to match `parentOverrides` structure.
        // Let's look up B's current effective parent.
        newParentId = parentOverrides.get(targetId);
        if (newParentId === undefined) {
            // If not overridden, could be opener.
            // But for consistent DragDrop we usually "break" opener bond and make it explicit root or child.
            // If B is root (null), A becomes root.
            // Since we don't have easy access to "effective parent" safely without re-running hierarchy logic,
            // let's peek at the DOM or simplify? 
            // Actually, `tabsMap` doesn't store computed parent easily.

            // Let's assume: if target is a Root in UI, new parent is null (-1).
            if (rootTabs.includes(targetId)) newParentId = -1;
            else {
                // Find who claims B as child
                // Expensive reverse lookup? Or just stick to explicit overrides?
                // If we don't know, we default to -1 (Root) or keep existing parent?
                // Better approach: Look at the DOM structure!
                const targetNode = document.querySelector(`.tab-tree-node[data-tab-id="${targetId}"]`);
                const parentNode = targetNode.parentElement.closest('.tab-tree-node');
                if (parentNode) {
                    newParentId = Number(parentNode.dataset.tabId);
                } else {
                    newParentId = -1; // Root
                }
            }
        }

        // Index: B's current index
        targetIndex = targetTab.index;

    } else if (action === 'after') {
        // A becomes sibling of B, placed after B (and B's subtree)

        // Parent: Same as 'before' case
        const targetNode = document.querySelector(`.tab-tree-node[data-tab-id="${targetId}"]`);
        const parentNode = targetNode.parentElement.closest('.tab-tree-node');
        if (parentNode) {
            newParentId = Number(parentNode.dataset.tabId);
        } else {
            newParentId = -1;
        }

        // Index: After B's entire subtree
        const targetSubtree = getSubtree(targetId);
        const lastDescendantId = targetSubtree[targetSubtree.length - 1];
        const lastDescendant = tabsMap.get(lastDescendantId);

        targetIndex = lastDescendant.index + 1;
    }

    // 3. Update Visual/Internal Hierarchy (Parent Overrides)
    // We only update the ROOT of the moving subtree
    if (newParentId === -1) {
        // Explicit root: delete override if we want to revert to opener? 
        // No, we want to FORCE root. So set to -1.
        parentOverrides.set(sourceId, -1);
    } else if (newParentId) {
        parentOverrides.set(sourceId, newParentId);
    } else {
        // undefined/null? Treat as root usually or keep existing. 
        // Safest is explicit -1 if we mean root.
        // If we matched a parent, set it.
    }

    await saveParentOverrides();

    // 4. Perform the Move (Chrome Tabs API)
    // We move the entire subtree to the new index.
    // NOTE: indices change as we move items.
    // Chrome API allows moving multiple tabs at once! `chrome.tabs.move(tabIds, {index})`
    // This is atomic and handles shifting much better.

    try {
        await chrome.tabs.move(movingIds, { index: targetIndex });
    } catch (err) {
        console.error("Move failed", err);
        // Fallback: re-render to at least show current state (even if move failed)
        fetchAndRenderTabs();
    }

    // The onMoved or onUpdated listener will trigger re-render
}

function getSubtree(rootId) {
    const results = [rootId];
    const tab = tabsMap.get(rootId);
    if (tab && tab.children) {
        for (const childId of tab.children) {
            results.push(...getSubtree(childId));
        }
    }
    return results;
}

// Hierarchy Override for Drag & Drop

async function loadParentOverrides() {
    const res = await chrome.storage.local.get('parentOverrides');
    if (res.parentOverrides) {
        parentOverrides = new Map(Object.entries(res.parentOverrides).map(([k, v]) => [Number(k), v]));
    }
}

async function saveParentOverrides() {
    await chrome.storage.local.set({
        parentOverrides: Object.fromEntries(parentOverrides)
    });
}

// --- Bookmarks Logic ---

async function fetchAndRenderBookmarks() {
    const listEl = document.getElementById('bookmarks-list');
    if (!listEl) return;
    listEl.innerHTML = ''; // Clear

    try {
        const tree = await chrome.bookmarks.getTree();
        // tree[0] is the root which contains "Bookmarks Bar", "Other Bookmarks", etc.
        // We usually want to render the children of the root directly to avoid "Root" folder.
        if (tree[0].children) {
            tree[0].children.forEach(node => {
                listEl.appendChild(createBookmarkNode(node));
            });
        }
    } catch (err) {
        console.error("Failed to load bookmarks", err);
        listEl.innerHTML = `<div style="padding:10px; color:var(--text-secondary);">Error loading bookmarks.</div>`;
    }
}

function createBookmarkNode(node) {
    const isFolder = !node.url;
    const container = document.createElement('div');
    container.className = 'bookmark-node';

    const item = document.createElement('div');
    item.className = `bookmark-item ${isFolder ? 'bookmark-folder' : ''}`;

    // Icon / Arrow
    if (isFolder) {
        const arrow = document.createElement('div');
        arrow.className = 'folder-arrow';
        arrow.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        item.appendChild(arrow);

        const icon = document.createElement('div');
        icon.className = 'folder-icon';
        icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        item.appendChild(icon);
    } else {
        const favicon = document.createElement('img');
        favicon.className = 'bookmark-favicon';
        favicon.src = getFaviconUrl({ url: node.url }); // Reuse existing helper
        favicon.onerror = () => { favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="%23ccc"><circle cx="7" cy="7" r="7"/></svg>'; };
        item.appendChild(favicon);
    }

    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.textContent = node.title || (isFolder ? 'Untitled Folder' : 'Untitled');
    title.style.overflow = 'hidden';
    item.appendChild(title);

    container.appendChild(item);

    // Children
    if (isFolder) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'bookmark-children';
        // Check if we want to expand by default? Maybe only "Bookmarks Bar"?
        // For now start collapsed unless we save state (out of scope for quick task, but better UX).

        // Render children
        if (node.children) {
            node.children.forEach(child => {
                childrenContainer.appendChild(createBookmarkNode(child));
            });
        }

        container.appendChild(childrenContainer);

        // Events
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = childrenContainer.classList.contains('expanded');
            if (isExpanded) {
                childrenContainer.classList.remove('expanded');
                item.querySelector('.folder-arrow').classList.remove('rotated');
            } else {
                childrenContainer.classList.add('expanded');
                item.querySelector('.folder-arrow').classList.add('rotated');
            }
        });
    } else {
        // Link Event
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const active = e.ctrlKey || e.metaKey ? false : true; // Ctrl+Click = background
            chrome.tabs.create({ url: node.url, active: active });
        });
    }

    return container;
}

// Refresh Button Listener
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-bookmarks');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', fetchAndRenderBookmarks);
    }
    // Also listen to bookmark events to auto-update?
    // chrome.bookmarks.onCreated.addListener(fetchAndRenderBookmarks);
    // chrome.bookmarks.onRemoved.addListener(fetchAndRenderBookmarks);
    // chrome.bookmarks.onChanged.addListener(fetchAndRenderBookmarks);
    // chrome.bookmarks.onMoved.addListener(fetchAndRenderBookmarks);
    // For now, static load on init is fine, but adding listeners is strictly better.
    if (chrome.bookmarks) {
        chrome.bookmarks.onCreated.addListener(() => fetchAndRenderBookmarks());
        chrome.bookmarks.onRemoved.addListener(() => fetchAndRenderBookmarks());
        chrome.bookmarks.onChanged.addListener(() => fetchAndRenderBookmarks());
        chrome.bookmarks.onMoved.addListener(() => fetchAndRenderBookmarks());
    }

    // Toggle Bookmarks/Downloads Logic
    const toggleBookmarksBtn = document.getElementById('toggle-bookmarks-btn');
    const toggleDownloadsBtn = document.getElementById('toggle-downloads-btn');

    const bookmarksSection = document.getElementById('bookmarks-section');
    const downloadsSection = document.getElementById('downloads-section');
    const divider = document.querySelector('.section-divider');

    // Default to hidden
    if (bookmarksSection) bookmarksSection.classList.add('hidden');
    if (downloadsSection) downloadsSection.classList.add('hidden');
    if (divider) divider.classList.add('hidden');

    function toggleSection(sectionName) {
        const isBookmarks = sectionName === 'bookmarks';
        const targetSection = isBookmarks ? bookmarksSection : downloadsSection;
        const otherSection = isBookmarks ? downloadsSection : bookmarksSection;
        const targetBtn = isBookmarks ? toggleBookmarksBtn : toggleDownloadsBtn;
        const otherBtn = isBookmarks ? toggleDownloadsBtn : toggleBookmarksBtn;

        if (!targetSection) return;

        // If currently hidden, show it and hide other
        if (targetSection.classList.contains('hidden')) {
            targetSection.classList.remove('hidden');
            if (otherSection) otherSection.classList.add('hidden');
            if (divider) divider.classList.remove('hidden');

            // Active states
            targetBtn.style.color = 'var(--accent-color)';
            if (otherBtn) otherBtn.style.color = '';

            // Load data if opening
            if (isBookmarks) {
                fetchAndRenderBookmarks();
            } else {
                fetchAndRenderDownloads();
            }
        } else {
            // Already open -> close it
            targetSection.classList.add('hidden');
            if (divider) divider.classList.add('hidden');
            targetBtn.style.color = '';
        }
    }

    if (toggleBookmarksBtn) toggleBookmarksBtn.addEventListener('click', () => toggleSection('bookmarks'));
    if (toggleDownloadsBtn) toggleDownloadsBtn.addEventListener('click', () => toggleSection('downloads'));

    // Refresh listener for downloads
    const refreshDlBtn = document.getElementById('refresh-downloads');
    if (refreshDlBtn) refreshDlBtn.addEventListener('click', fetchAndRenderDownloads);

});

// --- Downloads Logic ---

async function fetchAndRenderDownloads() {
    const listEl = document.getElementById('downloads-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    try {
        const items = await chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] });
        items.forEach(item => {
            listEl.appendChild(createDownloadNode(item));
        });
        if (items.length === 0) {
            listEl.innerHTML = `<div style="padding:10px; color:var(--text-secondary); text-align:center;">No recent downloads</div>`;
        }
    } catch (err) {
        console.error("Failed to load downloads", err);
        listEl.innerHTML = `<div style="padding:10px; color:var(--text-secondary);">Error loading downloads.</div>`;
    }
}

function createDownloadNode(item) {
    const container = document.createElement('div');
    container.className = 'download-item';

    // File Icon (Generic)
    const icon = document.createElement('div');
    icon.className = 'download-icon';
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
    container.appendChild(icon);

    // Info
    const info = document.createElement('div');
    info.className = 'download-info';

    const name = document.createElement('div');
    name.className = 'download-title';
    // chrome.downloads items have 'filename' (full path usually). extracting basename.
    // If filename is empty (interrupted?), use id or status
    const filename = item.filename ? item.filename.split(/[/\\]/).pop() : 'Unknown File';
    name.textContent = filename;
    info.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'download-meta';

    // Status Dot
    const dot = document.createElement('div');
    dot.className = `status-dot status-${item.state}`;
    meta.appendChild(dot);

    // Size or Status text
    let metaText = item.state;
    if (item.state === 'complete' || item.state === 'in_progress') {
        const size = formatBytes(item.fileSize || item.totalBytes);
        metaText = size;
    }
    const metaSpan = document.createElement('span');
    metaSpan.textContent = metaText;
    meta.appendChild(metaSpan);

    info.appendChild(meta);
    container.appendChild(info);

    // Click to Open
    container.addEventListener('click', () => {
        if (item.state === 'complete') {
            chrome.downloads.open(item.id).catch(err => {
                // Often fails if file is deleted. show in folder?
                chrome.downloads.show(item.id);
            });
        } else {
            // If active, maybe pause/resume? For now just show in folder
            chrome.downloads.show(item.id);
        }
    });

    return container;
}

function formatBytes(bytes, decimals = 1) {
    if (!bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
