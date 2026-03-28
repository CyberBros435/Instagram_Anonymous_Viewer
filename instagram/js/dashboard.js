let totalPostsAvailable = 0;
let postsTotalAvailable = 0;
let postsTotalReal = 0;
let postsShown = 0;
let currentUsername = null;
let postsCursor = null;
let reelsCursor = null;
let postsChart = null;
let reelsChart = null;

function waitForImages(container) {
    const images = container.querySelectorAll("img");
    if (images.length === 0) return Promise.resolve();

    const promises = Array.from(images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve; // Also resolve on error
        });
    });
    // Add a 10s timeout just in case
    const timeout = new Promise(resolve => setTimeout(resolve, 10000));
    return Promise.race([Promise.all(promises), timeout]);
}

const el = (id) => document.getElementById(id);

function showLoader(containerId, message = "Loading...") {
    const container = el(containerId);
    if (!container) return;
    container.innerHTML = `
        <div class="tab-loader">
            <div class="tab-spinner"></div>
            <div class="mt-2 small text-muted">${message}</div>
        </div>
    `;
}

function hideLoader(containerId) {
    const container = el(containerId);
    if (container) container.innerHTML = "";
}

function showGlobalLoader(show, title = "Loading Premium Dashboard...", sub = "Fetching profile insights") {
    const loader = el("globalLoading");
    const titleEl = el("globalLoaderTitle");
    const subEl = el("globalLoaderSub");

    if (show) {
        if (titleEl) titleEl.textContent = title;
        if (subEl) subEl.textContent = sub;
        loader.classList.remove("d-none");
        loader.style.opacity = "1";
    } else {
        loader.style.opacity = "0";
        setTimeout(() => loader.classList.add("d-none"), 300);
    }
}

function resetDashboardForNewSearch() {
    // close reel viewer if open
    try { closeReelViewer(); } catch (e) { }

    // clear grids + empty states
    el("postsGrid").innerHTML = "";
    el("reelsGrid").innerHTML = "";

    el("postsEmpty").classList.add("d-none");
    el("reelsEmpty").classList.add("d-none");

    // reset load more buttons
    el("loadMorePostsBtn").disabled = true;
    el("loadMorePostsBtn").textContent = "Load more";

    el("loadMoreReelsBtn").disabled = true;
    el("loadMoreReelsBtn").textContent = "Load more";

    // reset cursors
    postsCursor = null;
    reelsCursor = null;

    // reset loaded flags for new profile
    postsLoadedOnce = false;
    reelsLoadedOnce = false;

    // clear charts (optional but recommended)
    if (postsChart) { postsChart.destroy(); postsChart = null; }
    if (reelsChart) { reelsChart.destroy(); reelsChart = null; }
}

function showAlert(type, msg) {
    const html = `
    <div class="alert alert-${type} mt-3">
      <div class="d-flex justify-content-between align-items-start gap-3">
        <div>${msg}</div>
        <button class="btn btn-sm btn-outline-secondary" onclick="this.closest('.alert').remove()">Close</button>
      </div>
    </div>
  `;
    el("alertBox").innerHTML = html;
}

function clearAlert() {
    el("alertBox").innerHTML = "";
}

function cleanInputToUsername(raw) {
    if (!raw) return "";
    raw = raw.trim();

    // If user pasted full URL
    try {
        if (raw.startsWith("http://") || raw.startsWith("https://")) {
            const u = new URL(raw);
            // instagram.com/<username> or /<username>/
            const parts = u.pathname.split("/").filter(Boolean);
            if (parts.length > 0) raw = parts[0];
        }
    } catch (_) { }

    // remove @ and spaces
    raw = raw.replace("@", "").trim();

    // Keep only valid IG username chars: letters numbers . _
    raw = raw.replace(/[^a-zA-Z0-9._]/g, "");

    return raw;
}

function formatNumber(n) {
    if (n === null || n === undefined) return "—";
    if (typeof n !== "number") return String(n);

    // Instagram-like formatting
    if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
}


let postsLoadedOnce = false;
let reelsLoadedOnce = false;

async function setActiveTab(tabKey) {
    document.querySelectorAll("#igTabs .nav-link").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabKey);
    });

    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    el(`tab-${tabKey}`).classList.add("active");

    // ✅ Always show loader if switching to a media tab that might need rendering
    if (tabKey === "posts" || tabKey === "reels") {
        showGlobalLoader(true, `Opening ${tabKey}...`, "Rendering visual content");

        // Fetch if needed
        if (tabKey === "posts" && !postsLoadedOnce) {
            postsLoadedOnce = true;
            await loadPosts(true);
        } else if (tabKey === "reels" && !reelsLoadedOnce) {
            reelsLoadedOnce = true;
            await loadReels(true);
        }

        // Wait for images in the active grid specifically
        await waitForImages(el(`${tabKey}Grid`));
        showGlobalLoader(false);
    }

    if (tabKey === "analytics") {
        await loadAnalytics();
    }
}

function downloadFile(url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = ""; // browser hint, backend forces download
    document.body.appendChild(a);
    a.click();
    a.remove();
}


async function renderGrid(containerId, items, type, append = false) {
    const grid = el(containerId);
    if (!append) grid.innerHTML = "";

    items.forEach((it) => {
        const div = document.createElement("div");
        div.className = `grid-item ${type === "reel" ? "reel" : "post"}`;

        const rawThumb = (it.thumbnail || it.display_url || "").trim();
        const thumb = rawThumb ? `/api/media?src=${encodeURIComponent(rawThumb)}` : "";

        div.innerHTML = `
            <img class="grid-thumb" src="${thumb}" alt="thumb" loading="lazy" />

            <div class="grid-overlay">
                <div class="grid-metrics">
                    <div class="metric"><span class="icon">❤</span><span>${formatNumber(it.like_count)}</span></div>
                    <div class="metric"><span class="icon">💬</span><span>${formatNumber(it.comment_count)}</span></div>
                    ${type === "reel" ? `<div class="metric"><span class="icon">▶</span><span>${formatNumber(it.view_count)}</span></div>` : ""}
                </div>

                ${type === "post" ? `
                    <div class="grid-actions">
                        <button class="btn btn-sm btn-light preview-btn" type="button">Preview</button>
                        <button class="btn btn-sm btn-primary download-btn" type="button">Download</button>
                    </div>
                ` : ""}
            </div>
        `;

        // ✅ Click behavior
        div.addEventListener("click", () => {
            if (type === "reel") {
                openReelViewer(it);
            } else {
                openPostViewer(it); // ✅ click opens preview, NOT download
            }
        });

        // ✅ Post buttons
        if (type === "post") {
            div.querySelector(".preview-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                openPostViewer(it);
            });

            div.querySelector(".download-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                const src = (it.display_url || it.thumbnail || "").trim();
                if (!src) return;

                const a = document.createElement("a");
                a.href = `/api/download/media?src=${encodeURIComponent(src)}&name=${encodeURIComponent(it.shortcode || it.id || "post")}`;
                a.download = "";
                document.body.appendChild(a);
                a.click();
                a.remove();
            });
        }

        grid.appendChild(div);
    });

    // ✅ Wait for these images to load before we consider the "render" done
    await waitForImages(grid);
}


// --- Modal Logic ---
function openPostViewer(it) {
    const modal = el("premiumModal");
    el("modalTitle").textContent = "Post Preview";
    const container = el("modalMediaContainer");
    const src = it.display_url || it.thumbnail || "";
    container.innerHTML = `<img src="/api/media?src=${encodeURIComponent(src)}" class="img-fluid" />`;

    el("modalLikes").textContent = formatNumber(it.like_count);
    el("modalComments").textContent = formatNumber(it.comment_count);
    el("modalCommentsWrap").classList.remove("d-none");
    el("modalViewsWrap").classList.add("d-none");
    el("modalCaption").textContent = it.caption || "";

    el("modalDownloadBtn").onclick = () => {
        const a = document.createElement("a");
        a.href = `/api/download/media?src=${encodeURIComponent(src)}&name=${encodeURIComponent(it.shortcode || it.id || "post")}`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    modal.classList.remove("d-none");
    document.body.style.overflow = "hidden"; // prev scroll
}

function openReelViewer(reel) {
    if (!reel || !reel.video_url) {
        showAlert("warning", "Reel video URL is not publicly available right now.");
        return;
    }
    const modal = el("premiumModal");
    el("modalTitle").textContent = "Reel Preview";
    const container = el("modalMediaContainer");
    const src = reel.video_url;
    container.innerHTML = `<video controls autoplay loop playsinline src="/api/media?src=${encodeURIComponent(src)}" style="width:100%"></video>`;

    el("modalLikes").textContent = formatNumber(reel.like_count);
    el("modalComments").textContent = formatNumber(reel.comment_count);
    el("modalViews").textContent = formatNumber(reel.view_count);
    el("modalCommentsWrap").classList.remove("d-none");
    el("modalViewsWrap").classList.remove("d-none");
    el("modalCaption").textContent = reel.caption || "";

    el("modalDownloadBtn").onclick = () => {
        const a = document.createElement("a");
        a.href = `/api/download/media?src=${encodeURIComponent(src)}&name=${encodeURIComponent(reel.shortcode || reel.id || "reel")}`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    modal.classList.remove("d-none");
    document.body.style.overflow = "hidden";
}

function closeModal() {
    const modal = el("premiumModal");
    const container = el("modalMediaContainer");
    container.innerHTML = ""; // stop video
    modal.classList.add("d-none");
    document.body.style.overflow = ""; // restore scroll
}

function setProfilePicCircle(username) {
    const img = el("profilePic");
    if (!img || !username) return;

    // keep last working image (so it doesn't go black)
    const lastGood = img.dataset.lastGood || "";

    let tries = 0;
    const maxTries = 10;

    const tryLoad = () => {
        tries++;

        // IMPORTANT: load via YOUR backend (same origin)
        const url = `/api/profile-pic?u=${encodeURIComponent(username)}&t=${Date.now()}`;
        img.src = url;
    };

    img.onload = () => {
        img.dataset.lastGood = img.src; // save last working
    };

    img.onerror = () => {
        if (tries < maxTries) {
            setTimeout(tryLoad, 700 * tries);
            return;
        }

        // if failed after retries: keep last good image (DON'T set svg fallback)
        if (lastGood) img.src = lastGood;

        // optional message
        // showAlert("warning", "Profile picture couldn't load right now. Try again.");
    };

    tryLoad();
}

async function fetchProfile(username) {
    clearAlert();
    resetDashboardForNewSearch();
    el("profileSection").classList.add("d-none");

    // ✅ reset cursors
    postsCursor = null;
    reelsCursor = null;

    // ✅ reset "loaded once" flags (so next username loads posts/reels only when tab opened)
    postsLoadedOnce = false;
    reelsLoadedOnce = false;

    showGlobalLoader(true, "Searching Profile...", "Fetching account metadata");

    try {
        const res = await fetch(`/api/profile?u=${encodeURIComponent(username)}`);
        const data = await res.json();

        // Limit check always update
        await updateLimits();

        if (!data.status) {
            // If Instagram cooldown OR Backend Limit
            if (data.code === "LIMIT_REACHED") {
                showAlert("danger", `<b>Limit Reached:</b> ${data.message}`);
                return;
            }

            if (data.code === "COOLDOWN" || data.code === "IG_BLOCKED") {
                const wait = Number(data.retry_after || 15);
                showAlert(
                    "warning",
                    (data.message || "Instagram limited requests.") +
                    `<br><b>Please wait ${wait}s</b> then try again.`
                );
                return;
            }

            showAlert("danger", data.message || "Failed to fetch profile.");
            return;
        }

        // ✅ Use payload data
        const profile = data.data;
        currentUsername = profile.username;
        currentUserId = profile.id; // Save ID

        // Fill header
        el("igUsername").textContent = profile.username || "—";
        el("fullName").textContent = profile.full_name || "";
        el("bio").textContent = profile.biography || "";

        // ✅ IMPORTANT: Always load profile pic via backend proxy (same-origin)
        setProfilePicCircle(currentUsername);

        el("postsCount").textContent = formatNumber(profile.posts_count);
        el("followersCount").textContent = formatNumber(profile.followers);
        el("followingCount").textContent = formatNumber(profile.following);

        // profile url
        el("profileUrl").textContent = profile.profile_url || "";
        el("profileUrl").href = profile.profile_url || "#";

        // external link
        if (profile.external_url) {
            el("externalLink").classList.remove("d-none");
            el("externalLink").href = profile.external_url;
            el("externalLink").textContent = profile.external_url;
        } else {
            el("externalLink").classList.add("d-none");
        }

        // badge
        const badge = el("privacyBadge");
        badge.className = "privacy-badge";
        if (profile.is_private) {
            badge.textContent = "PRIVATE";
            badge.classList.add("private");
            el("privateNotice").classList.remove("d-none");
        } else {
            badge.textContent = "PUBLIC";
            badge.classList.add("public");
            el("privateNotice").classList.add("d-none");
        }

        // ✅ Download button
        el("downloadPfpBtn").onclick = () => {
            const url = `/api/download/profile-pic?u=${encodeURIComponent(currentUsername)}&t=${Date.now()}`;
            const a = document.createElement("a");
            a.href = url;
            a.download = "";
            document.body.appendChild(a);
            a.click();
            a.remove();
        };

        el("copyUrlBtn").onclick = async () => {
            try {
                await navigator.clipboard.writeText(profile.profile_url);
                showAlert("success", "Profile URL copied.");
            } catch {
                showAlert("warning", "Clipboard blocked by browser. Copy manually: " + profile.profile_url);
            }
        };

        // Profile computed analytics
        el("engagementEst").textContent = profile.analytics?.engagement_estimate || "—";
        el("postingFreq").textContent = profile.analytics?.posting_frequency || "—";
        el("lastPostDate").textContent = profile.analytics?.last_post_date || "—";

        // show dashboard
        el("profileSection").classList.remove("d-none");

        // ✅ IMPORTANT: LOAD INITIAL POSTS / REELS
        if (!profile.is_private) {
            // Analytics - don't hide loader yet
            await loadAnalytics(false);

            // 1. Handle Posts
            if (data.data.posts) {
                const pData = data.data.posts;
                const pItems = pData.items || [];
                postsCursor = pData.next_cursor || null;

                if (pItems.length > 0) {
                    await renderGrid("postsGrid", pItems, "post", false);
                    el("postsEmpty").classList.add("d-none");
                } else {
                    el("postsEmpty").classList.remove("d-none");
                    el("postsEmpty").innerHTML = `<div>No posts found.</div>`;
                }

                if (pData.has_next) {
                    el("loadMorePostsBtn").disabled = false;
                    el("loadMorePostsBtn").textContent = "Load more";
                } else {
                    el("loadMorePostsBtn").disabled = true;
                    el("loadMorePostsBtn").textContent = "No more posts";
                }
                postsLoadedOnce = true;
            }

            // 2. Handle Reels
            if (data.data.reels) {
                const rData = data.data.reels;
                const rItems = rData.items || [];
                reelsCursor = rData.next_cursor || null;

                if (rItems.length > 0) {
                    await renderGrid("reelsGrid", rItems, "reel", false);
                    el("reelsEmpty").classList.add("d-none");
                } else {
                    el("reelsEmpty").classList.remove("d-none");
                    el("reelsEmpty").innerHTML = `<div>No reels found.</div>`;
                }

                if (rData.has_next) {
                    el("loadMoreReelsBtn").disabled = false;
                    el("loadMoreReelsBtn").textContent = "Load more";
                } else {
                    el("loadMoreReelsBtn").disabled = true;
                    el("loadMoreReelsBtn").textContent = "No more reels";
                }
                reelsLoadedOnce = true;
            }
        } else {
            // private profile: no content
            el("postsGrid").innerHTML = "";
            el("reelsGrid").innerHTML = "";
            el("postsEmpty").classList.remove("d-none");
            el("reelsEmpty").classList.remove("d-none");

            el("loadMorePostsBtn").disabled = true;
            el("loadMorePostsBtn").textContent = "Private";
            el("loadMoreReelsBtn").disabled = true;
            el("loadMoreReelsBtn").textContent = "Private";
        }

        // ✅ Finished Everything in memory
        setActiveTab("profile");

        // ✅ FINAL SYNC: Wait for Profile Pic + Both Media Grids to be ready
        // This ensures the dashboard feels "instantly solid" when it appears
        await Promise.all([
            waitForImages(el("profileSection")),
            waitForImages(el("postsGrid")),
            waitForImages(el("reelsGrid"))
        ]);

        // NOW reveal dashboard
        el("profileSection").classList.remove("d-none");

    } catch (e) {
        console.error(e);
        showAlert("danger", "Failed to load profile. Check connection.");
    } finally {
        // We hide the loader in the calling function for perfect UI synchronization
    }
}

async function loadPosts(reset = false, hideLoaderAfter = true) {
    if (!currentUsername) return;

    showGlobalLoader(true, reset ? "Initializing Posts..." : "Loading More Posts...", "Waiting for high-quality images");

    if (reset) {
        postsCursor = null;
        el("postsEmpty").classList.add("d-none");
        el("loadMorePostsBtn").disabled = true;
        el("loadMorePostsBtn").innerHTML = '<span class="spinner me-2"></span> Loading...';
        el("loadMorePostsBtn").parentElement?.classList.remove("d-none");
    }

    let url = `/api/posts?u=${encodeURIComponent(currentUsername)}`;
    if (postsCursor) url += `&cursor=${encodeURIComponent(postsCursor)}`;
    if (currentUserId) url += `&uid=${encodeURIComponent(currentUserId)}`;

    const btn = el("loadMorePostsBtn");
    if (!reset) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner me-2"></span> Loading...';
    }

    try {
        const res = await fetch(url);

        if (res.status === 429 || res.status === 403) {
            btn.disabled = true;
            btn.textContent = "Request Blocked";
            if (reset) {
                el("postsEmpty").classList.remove("d-none");
                el("postsEmpty").innerHTML = `<div class="text-danger">Instagram blocked (${res.status}).</div>`;
            }
            return;
        }

        const data = await res.json();
        if (!data.status) {
            if (reset) {
                el("postsEmpty").classList.remove("d-none");
                el("postsEmpty").innerHTML = `<div class="text-danger">Error: ${data.message}</div>`;
            } else {
                btn.disabled = false;
                btn.textContent = "Try again";
            }
            return;
        }

        const items = data.data.items || [];
        postsCursor = data.data.next_cursor || null;
        const hasNext = data.data.has_next;

        if (items.length === 0 && reset) {
            el("postsEmpty").classList.remove("d-none");
            el("postsEmpty").innerHTML = `<div>No posts found.</div>`;
            btn.disabled = true;
            btn.textContent = "No posts";
            return;
        }

        el("postsEmpty").classList.add("d-none");
        await renderGrid("postsGrid", items, "post", !reset);

        if (!hasNext) {
            btn.disabled = true;
            btn.textContent = "No more posts";
        } else {
            btn.disabled = false;
            btn.textContent = "Load more";
        }
    } catch (e) {
        console.error(e);
        if (!reset) {
            btn.disabled = false;
            btn.textContent = "Load more";
        }
    } finally {
        if (hideLoaderAfter) showGlobalLoader(false);
    }
}

async function loadReels(reset = false, hideLoaderAfter = true) {
    if (!currentUsername) return;

    showGlobalLoader(true, reset ? "Initializing Reels..." : "Loading More Reels...", "Syncing video previews");

    if (reset) {
        reelsCursor = null;
        el("reelsEmpty").classList.add("d-none");
        el("loadMoreReelsBtn").disabled = true;
        el("loadMoreReelsBtn").innerHTML = '<span class="spinner me-2"></span> Loading...';
    }

    let url = `/api/reels?u=${encodeURIComponent(currentUsername)}`;
    if (reelsCursor) url += `&cursor=${encodeURIComponent(reelsCursor)}`;
    if (currentUserId) url += `&uid=${encodeURIComponent(currentUserId)}`;

    const btn = el("loadMoreReelsBtn");
    if (!reset) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner me-2"></span> Loading...';
    }

    try {
        const res = await fetch(url);

        if (res.status === 429 || res.status === 403) {
            btn.disabled = true;
            btn.textContent = "Request Blocked";
            if (reset) {
                el("reelsEmpty").classList.remove("d-none");
                el("reelsEmpty").innerHTML = `<div class="text-danger">Instagram blocked (${res.status}).</div>`;
            }
            return;
        }

        const data = await res.json();
        if (!data.status) {
            if (reset) {
                el("reelsEmpty").classList.remove("d-none");
                el("reelsEmpty").innerHTML = `<div class="text-danger">${data.message}</div>`;
            } else {
                btn.disabled = false;
                btn.textContent = "Try again";
            }
            return;
        }

        const items = data.data.items || [];
        reelsCursor = data.data.next_cursor || null;
        const hasNext = data.data.has_next;

        if (items.length === 0 && reset) {
            el("reelsEmpty").classList.remove("d-none");
            el("reelsEmpty").innerHTML = `<div>No reels found.</div>`;
            return;
        }

        el("reelsEmpty").classList.add("d-none");
        await renderGrid("reelsGrid", items, "reel", !reset);

        if (!hasNext) {
            btn.disabled = true;
            btn.textContent = "No more reels";
        } else {
            btn.disabled = false;
            btn.textContent = "Load more";
        }
    } catch (e) {
        console.error(e);
        if (!reset) {
            btn.disabled = false;
            btn.textContent = "Load more";
        }
    } finally {
        if (hideLoaderAfter) showGlobalLoader(false);
    }
}


function buildChart(existing, canvasId, labels, dataPoints, labelText) {
    if (existing) existing.destroy();
    const ctx = el(canvasId);
    return new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: labelText,
                data: dataPoints,
                tension: 0.35,
                fill: false
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: true }
            },
            scales: {
                x: { ticks: { color: "#a5a8b6" } },
                y: { ticks: { color: "#a5a8b6" } }
            }
        }
    });
}

async function loadAnalytics(hideLoaderAfter = true) {
    if (!currentUsername) return;

    showGlobalLoader(true, "Analyzing Data...", "Calculating engagement rates");

    // Show loaders in chart containers
    const pContainer = el("postsChart").parentElement;
    const rContainer = el("reelsChart").parentElement;

    // Clear and add loader
    pContainer.innerHTML = '<canvas id="postsChart"></canvas><div id="postsLoad" class="tab-loader"><div class="tab-spinner"></div></div>';
    rContainer.innerHTML = '<canvas id="reelsChart"></canvas><div id="reelsLoad" class="tab-loader"><div class="tab-spinner"></div></div>';

    try {
        const res = await fetch(`/api/analytics?u=${encodeURIComponent(currentUsername)}`);
        const data = await res.json();

        // Remove loaders
        el("postsLoad")?.remove();
        el("reelsLoad")?.remove();

        if (!data.status) return;

        const posts = data.data.posts || { labels: [], values: [] };
        const reels = data.data.reels || { labels: [], values: [] };

        postsChart = buildChart(postsChart, "postsChart", posts.labels, posts.values, "Engagement (likes+comments)");
        reelsChart = buildChart(reelsChart, "reelsChart", reels.labels, reels.values, "Reel performance (views if available)");
    } catch (e) {
        console.error("Analytics fetch error", e);
        el("postsLoad")?.remove();
        el("reelsLoad")?.remove();
    } finally {
        if (hideLoaderAfter) showGlobalLoader(false);
    }
}

// Hints dropdown
function renderHints(inputVal) {
    const box = el("hintBox");
    const u = cleanInputToUsername(inputVal);

    if (!inputVal || inputVal.trim().length === 0) {
        box.classList.add("d-none");
        return;
    }

    const candidates = [];
    if (u) candidates.push({ title: `@${u}`, sub: "Search by username" });
    if (inputVal.startsWith("http")) candidates.push({ title: `Use profile link`, sub: "Paste full Instagram URL" });
    candidates.push({ title: `Example: @cristiano`, sub: "Try a sample username" });

    box.innerHTML = "";
    candidates.forEach(c => {
        const div = document.createElement("div");
        div.className = "hint-item";
        div.innerHTML = `<div class="fw-semibold">${c.title}</div><div class="small">${c.sub}</div>`;
        div.onclick = () => {
            if (c.title.startsWith("@")) {
                el("usernameInput").value = c.title.replace("@", "");
            } else if (c.title.includes("Example")) {
                el("usernameInput").value = "cristiano";
            }
            box.classList.add("d-none");
            el("usernameInput").focus();
        };
        box.appendChild(div);
    });

    box.classList.remove("d-none");
}

// Limit updater
async function updateLimits() {
    try {
        const res = await fetch("/api/limits");
        const json = await res.json();
        if (json.status) {
            const { used, total } = json.data;
            const elTxt = el("limitText");
            const elBar = el("limitBar");
            const usedVal = parseInt(used) || 0;
            const totalVal = parseInt(total) || 1; // avoid div 0

            if (elTxt) {
                elTxt.textContent = `${usedVal} / ${totalVal}`;
            }

            if (elBar) {
                const percent = Math.min((usedVal / totalVal) * 100, 100);
                elBar.style.width = `${percent}%`;

                // Color coding
                if (percent > 90) {
                    elBar.classList.remove("bg-primary");
                    elBar.classList.add("bg-danger");
                } else if (percent > 70) {
                    elBar.classList.remove("bg-primary");
                    elBar.classList.add("bg-warning");
                } else {
                    elBar.classList.remove("bg-danger", "bg-warning");
                    elBar.classList.add("bg-primary");
                }
            }

            if (usedVal >= totalVal) {
                if (elTxt) elTxt.classList.add("text-danger");
                el("viewBtn").disabled = true;
                el("viewBtn").textContent = "Limit Reached";
            }
        }
    } catch (e) {
        console.error("Limit fetch error", e);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    updateLimits();

    // Tabs
    document.querySelectorAll("#igTabs .nav-link").forEach(btn => {
        btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    });

    // ... existing ... (removing duplicated closing bracket below if needed or just appending correctly)

    // Mobile Menu Toggle
    const hamburger = el("hamburgerBtn");
    const navMenu = el("navbarMenu");
    if (hamburger && navMenu) {
        hamburger.addEventListener("click", () => {
            hamburger.classList.toggle("active");
            navMenu.classList.toggle("active");
        });
    }

    // Close mobile menu on link click
    document.querySelectorAll(".navbar-links-center a").forEach(link => {
        link.addEventListener("click", () => {
            hamburger?.classList.remove("active");
            navMenu?.classList.remove("active");
        });
    });

    el("viewBtn").addEventListener("click", async () => {
        const raw = el("usernameInput").value;
        const username = cleanInputToUsername(raw);

        if (!username) {
            showAlert("warning", "Please enter a valid @username or Instagram profile link.");
            return;
        }

        // Show global loading overlay
        showGlobalLoader(true, "Searching Profile...", "Fetching account metadata");

        // Also update button state
        const btn = el("viewBtn");
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Loading...';

        try {
            await fetchProfile(username);
        } finally {
            // Restore button state
            btn.disabled = false;
            btn.textContent = originalText;

            // Sync with global loader: Hide exactly when button is restored
            showGlobalLoader(false);
        }
    });

    el("loadMorePostsBtn").addEventListener("click", () => loadPosts(false));
    el("loadMoreReelsBtn").addEventListener("click", () => loadReels(false));
    el("refreshAnalyticsBtn").addEventListener("click", loadAnalytics);

    // el("unlimitedBtn") removed
    // el("trackingBtn") removed

    el("privacyNoteBtn").addEventListener("click", () => {
        showAlert(
            "secondary",
            "We respect privacy — only public content is available. No login required. This tool may be blocked by Instagram sometimes."
        );
    });

    el("closeModalBtn").addEventListener("click", closeModal);
    el("premiumModal").addEventListener("click", (e) => {
        if (e.target === el("premiumModal")) closeModal();
    });

    el("usernameInput").addEventListener("input", (e) => renderHints(e.target.value));

    // hide hints on outside click
    document.addEventListener("click", (e) => {
        const hint = el("hintBox");
        const wrap = document.querySelector(".search-wrap");
        if (wrap && !wrap.contains(e.target)) hint.classList.add("d-none");
    });
});
