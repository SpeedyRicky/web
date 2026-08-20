// ClipRoots — personal clip bank. Every clip the signed-in account has
// ever saved, public or private, in one place. Reuses clips_feed (same
// view the homepage feed and profile pages use) filtered to the
// viewer's own author_id — RLS already lets an owner see their own
// private clips through that view, so no separate query path is
// needed. A clip currently hidden pending a report (claim_status =
// 'resolved_removed') stays out of this list too, same as everywhere
// else on the site - clips_feed excludes those unconditionally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.MARGINAL_CONFIG;
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const container = document.getElementById("container");

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function formatClipTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

let currentSession = null;

async function init() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;

  if (!currentSession) {
    renderSignIn();
    return;
  }

  loadBank();
}

function renderSignIn() {
  container.innerHTML = `
    <div class="card" style="padding:24px 26px;">
      <form id="bank-signin-form" class="signin-form">
        <p class="signin-hint">Sign in with email to see your clips.</p>
        <div class="comment-form-actions">
          <input class="signin-email" id="bank-signin-email" type="email" placeholder="you@example.com" required />
          <button type="submit" class="btn btn-primary">Email me a link</button>
        </div>
        <p id="bank-signin-status" class="signin-status" style="display:none;"></p>
      </form>
    </div>
  `;
  document.getElementById("bank-signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailEl = document.getElementById("bank-signin-email");
    const statusEl = document.getElementById("bank-signin-status");
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

async function loadBank() {
  container.innerHTML = `<div id="bank-list"><p class="feed-state">Loading…</p></div>`;
  const listEl = document.getElementById("bank-list");

  const { data, error } = await supabase
    .from("clips_feed")
    .select("*")
    .eq("author_id", currentSession.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="feed-state">Couldn't load your clips.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    listEl.innerHTML = `<p class="feed-state">No clips yet — save one with the ClipRoots extension and it'll show up here.</p>`;
    return;
  }

  listEl.innerHTML = `<div class="activity-list">${data.map(renderEntry).join("")}</div>`;
}

function renderEntry(c) {
  const isVideo = c.clip_type === "video";
  const body = isVideo
    ? `<span class="activity-video-tag">▶ ${formatClipTime(c.video_start_seconds)} – ${formatClipTime(c.video_end_seconds)}</span><p>${escapeHtml(c.commentary || "video clip")}</p>`
    : `<p>"${escapeHtml((c.quoted_text || "").slice(0, 140))}${(c.quoted_text || "").length > 140 ? "…" : ""}"</p>`;
  const dateStr = new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase();
  return `
    <a class="activity-entry" href="clip.html?slug=${encodeURIComponent(c.slug)}">
      <div class="activity-date">${dateStr}${c.is_private ? `<span class="op">Private</span>` : ""}</div>
      <div class="activity-body">${body}</div>
      <div class="activity-meta">${isVideo ? "Video clip" : "Text clip"}<span class="src">${escapeHtml(c.source_domain || "web")}</span></div>
    </a>
  `;
}

supabase.auth.onAuthStateChange(() => {
  init();
});

init();
