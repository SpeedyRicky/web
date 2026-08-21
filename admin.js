// ClipRoots — internal admin review queue. Not linked from anywhere in
// the site nav; reachable only by direct URL, and gated entirely by
// profiles.is_admin (RLS: "admins can view all clips"/"admins can delete
// clips under review"/"admins can view all claims" - see migrations
// add_admin_role_and_require_account_for_reports and
// admins_can_view_all_claims). A non-admin who signs in and loads this
// page sees "You don't have access to this page." and nothing else -
// the RLS policies would return zero rows for them anyway, this is just
// a clearer message than an empty list.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.MARGINAL_CONFIG;
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const container = document.getElementById("container");

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function initials(name) { return (name || "?").trim().slice(0, 2).toUpperCase(); }

function formatClipTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

let currentSession = null;

async function init() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;

  if (!currentSession) {
    renderSignIn();
    return;
  }

  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", currentSession.user.id).maybeSingle();

  if (!profile || profile.is_admin !== true) {
    container.innerHTML = `<p class="clip-not-found">You don't have access to this page.</p>`;
    return;
  }

  loadQueue();
}

function renderSignIn() {
  container.innerHTML = `
    <div class="card" style="padding:24px 26px;">
      <form id="admin-signin-form" class="signin-form">
        <p class="signin-hint">Sign in with your ClipRoots admin account.</p>
        <div class="comment-form-actions">
          <input class="signin-email" id="admin-signin-email" type="email" placeholder="you@example.com" required />
          <button type="submit" class="btn btn-primary">Email me a link</button>
        </div>
        <p id="admin-signin-status" class="signin-status" style="display:none;"></p>
      </form>
    </div>
  `;
  document.getElementById("admin-signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailEl = document.getElementById("admin-signin-email");
    const statusEl = document.getElementById("admin-signin-status");
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const email = emailEl.value.trim();
    if (!email) return;
    statusEl.style.display = "block";
    statusEl.textContent = "Sending…";
    if (submitBtn) submitBtn.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { emailRedirectTo: location.href }
      });
      statusEl.textContent = error ? error.message : "Check your email for a sign-in link.";
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

async function loadQueue() {
  container.innerHTML = `
    <h1 class="display" style="font-size:22px;margin-bottom:20px;">Clips under review</h1>
    <div id="admin-queue"><p class="feed-state">Loading…</p></div>
  `;
  const queueEl = document.getElementById("admin-queue");

  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("*, profiles(username, display_name)")
    .eq("claim_status", "resolved_removed")
    .order("created_at", { ascending: false });

  if (clipsError) {
    queueEl.innerHTML = `<p class="feed-state">Couldn't load the review queue.</p>`;
    return;
  }
  if (!clips || clips.length === 0) {
    queueEl.innerHTML = `<p class="feed-state">Nothing under review right now.</p>`;
    return;
  }

  const clipIds = clips.map((c) => c.id);
  const { data: claims } = await supabase
    .from("claims")
    .select("*, profiles(username)")
    .in("clip_id", clipIds)
    .order("created_at", { ascending: false });

  const claimsByClip = new Map();
  (claims || []).forEach((c) => {
    if (!claimsByClip.has(c.clip_id)) claimsByClip.set(c.clip_id, []);
    claimsByClip.get(c.clip_id).push(c);
  });

  queueEl.innerHTML = clips.map((c) => renderClipCard(c, claimsByClip.get(c.id) || [])).join("");

  queueEl.querySelectorAll(".admin-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.clipId));
  });
  queueEl.querySelectorAll(".admin-keep-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleKeep(btn.dataset.clipId));
  });
}

function renderClipCard(c, claims) {
  const author = c.profiles?.display_name || c.profiles?.username || "someone";
  const isVideo = c.clip_type === "video";
  const body = isVideo
    ? `<span class="activity-video-tag">▶ ${formatClipTime(c.video_start_seconds)} – ${formatClipTime(c.video_end_seconds)}</span><p>${escapeHtml(c.commentary || "video clip")}</p>`
    : `<p>"${escapeHtml((c.quoted_text || "").slice(0, 200))}${(c.quoted_text || "").length > 200 ? "…" : ""}"</p>`;

  const claimsHtml = claims.map((claim) => `
    <div class="comment">
      <div class="comment-head">
        <span class="comment-avatar">${initials(claim.profiles?.username)}</span>
        <span class="comment-author">@${escapeHtml(claim.profiles?.username || "unknown")}</span>
        <span class="comment-time">${timeAgo(claim.created_at)}</span>
      </div>
      <p class="comment-body">${escapeHtml(claim.reason)}</p>
    </div>
  `).join("");

  return `
    <div class="card" style="padding:20px 22px;margin-bottom:16px;">
      <div class="author-row">
        <span class="avatar">${initials(author)}</span>
        <span><b>${escapeHtml(author)}</b> · <a class="profile-link" href="profiles.html?username=${encodeURIComponent(c.profiles?.username || "")}">@${escapeHtml(c.profiles?.username || "")}</a></span>
      </div>
      ${body}
      <div class="source-box">
        <span>${escapeHtml(c.source_domain || "")}</span>
        <a href="${escapeHtml(c.source_url || "#")}" target="_blank" rel="noopener">View source ↗</a>
      </div>
      <p class="meta">Clipped ${timeAgo(c.created_at)} · <a href="clip.html?slug=${encodeURIComponent(c.slug)}">direct link</a> (visitors can't see it — you can, as admin)</p>
      ${claims.length ? `<div class="comments" style="margin:14px 0;">${claimsHtml}</div>` : `<p class="feed-state" style="padding:8px 0;">No report on file for this clip.</p>`}
      <div class="claim-actions" style="justify-content:flex-start;margin-top:8px;">
        <button class="btn btn-ghost admin-keep-btn" type="button" data-clip-id="${escapeHtml(c.id)}">Keep — dismiss report</button>
        <button class="btn btn-ghost admin-delete-btn" type="button" data-clip-id="${escapeHtml(c.id)}" style="color:var(--alert);border-color:var(--alert);">Delete permanently</button>
      </div>
    </div>
  `;
}

async function handleDelete(clipId) {
  if (!confirm("Permanently delete this clip? This cannot be undone.")) return;
  const btn = document.querySelector(`.admin-delete-btn[data-clip-id="${CSS.escape(clipId)}"]`);
  if (btn) btn.disabled = true;
  try {
    const { error } = await supabase.from("clips").delete().eq("id", clipId);
    if (error) {
      alert(error.message || "Couldn't delete this clip. Try again.");
      if (btn) btn.disabled = false;
      return;
    }
    loadQueue();
  } catch (e) {
    alert(e.message || "Couldn't delete this clip. Try again.");
    if (btn) btn.disabled = false;
  }
}

// "Keep" moves claim_status off resolved_removed - clips_feed excludes
// only that exact value, so any other status (resolved_kept here) makes
// the clip visible again everywhere. resolved_kept also permanently
// shields this clip from the repeat-infringer trigger's future cascades.
async function handleKeep(clipId) {
  if (!confirm("Restore this clip? It will become publicly visible again.")) return;
  const btn = document.querySelector(`.admin-keep-btn[data-clip-id="${CSS.escape(clipId)}"]`);
  if (btn) btn.disabled = true;
  try {
    const { error } = await supabase.from("clips").update({ claim_status: "resolved_kept" }).eq("id", clipId);
    if (error) {
      alert(error.message || "Couldn't restore this clip. Try again.");
      if (btn) btn.disabled = false;
      return;
    }
    loadQueue();
  } catch (e) {
    alert(e.message || "Couldn't restore this clip. Try again.");
    if (btn) btn.disabled = false;
  }
}

supabase.auth.onAuthStateChange(() => {
  init();
});

init();
