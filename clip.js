// ClipNoter — public clip landing page logic.
// Reads the clip by slug and renders it into the .clip-card component
// (the same one the homepage uses for its preview), then wires up
// comments (magic-link sign-in required, per the "authenticated users
// can comment" RLS policy) and the "File a claim" dialog, which inserts
// directly into `claims` with the anon key via the "anyone can file a
// claim" RLS policy — no account needed for that.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.MARGINAL_CONFIG;
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const params = new URLSearchParams(location.search);
const slug = params.get("slug");
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

// Rewrites a source URL to jump straight to the clipped moment, for the
// hosts that support a start-time query param. Falls back to the plain
// URL everywhere else (or if the URL doesn't parse).
function withStartTime(url, seconds) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      u.searchParams.set("t", `${Math.max(0, Math.floor(Number(seconds) || 0))}s`);
      return u.toString();
    }
  } catch {
    // not a valid absolute URL — fall through to the raw value
  }
  return url;
}

let currentClip = null;
let currentSession = null;

async function loadClip() {
  if (!slug) {
    container.innerHTML = `<p class="clip-not-found">No clip specified.</p>`;
    return;
  }
  const { data, error } = await supabase.from("clips_feed").select("*").eq("slug", slug).single();
  if (error || !data) {
    container.innerHTML = `<p class="clip-not-found">This clip doesn't exist or was removed.</p>`;
    return;
  }
  currentClip = data;
  const claimBanner = data.claim_status === "filed"
    ? `<div class="claim-banner">⚠ A rights claim has been filed on this clip. It is under review.</div>` : "";

  const isVideo = data.clip_type === "video";
  const quoteBlock = isVideo
    ? `<span class="activity-video-tag">▶ ${formatClipTime(data.video_start_seconds)} – ${formatClipTime(data.video_end_seconds)}</span>`
    : `<blockquote class="clip-quote">"${escapeHtml(data.quoted_text)}"</blockquote>`;
  const sourceHref = isVideo ? withStartTime(data.source_url, data.video_start_seconds) : data.source_url;

  container.innerHTML = `
    <div class="clip-card">
      <div class="clip-card-bar">
        <span>CLIP ${escapeHtml((data.slug || "").slice(0, 8).toUpperCase())}</span>
        <span>SAVED</span>
      </div>
      <div class="clip-card-body">
        <div class="clip-author">
          <span class="clip-avatar">${initials(data.author_display_name || data.author_username)}</span>
          <span><b>${escapeHtml(data.author_display_name || data.author_username)}</b> · @${escapeHtml(data.author_username)}</span>
        </div>
        ${claimBanner}
        ${quoteBlock}
        ${data.commentary ? `<p class="clip-card-row" style="display:block;">${escapeHtml(data.commentary)}</p>` : ""}
        <div class="clip-source">
          <span>${escapeHtml(data.source_domain || "")}</span>
          <a href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener">${isVideo ? "Watch clip ↗" : "View original ↗"}</a>
        </div>
        <div class="clip-published">Published ${new Date(data.created_at).toLocaleString()}</div>
        <div class="clip-claim-row"><button class="btn btn-ghost" id="open-claim" type="button">File a claim</button></div>
      </div>
    </div>

    <section class="section comments-section" id="comments">
      <div class="section-head" style="margin-bottom:20px;">
        <h2 class="display" style="font-size:19px;">Comments</h2>
        <p>Discuss this clip with the ClipNoter community.</p>
      </div>
      <div class="comments" id="comments-list"></div>
      <div id="comment-composer"></div>
    </section>
  `;

  document.getElementById("open-claim").addEventListener("click", () => {
    document.getElementById("claim-dialog").showModal();
  });

  renderComposer();
  loadComments();
}

async function loadComments() {
  const { data, error } = await supabase
    .from("comments")
    .select("body, created_at, profiles(username, display_name)")
    .eq("clip_id", currentClip.id)
    .order("created_at", { ascending: true });
  const listEl = document.getElementById("comments-list");
  if (error) {
    listEl.innerHTML = `<p class="comments-empty">Couldn't load comments.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    listEl.innerHTML = `<p class="comments-empty">No comments yet.</p>`;
    return;
  }
  listEl.innerHTML = data.map((c) => `
    <div class="comment">
      <span class="comment-author">${escapeHtml(c.profiles?.display_name || c.profiles?.username || "someone")}</span>
      <p class="comment-body">${escapeHtml(c.body)}</p>
    </div>
  `).join("");
}

// Comments require an authenticated user (RLS: auth.uid() = user_id), and
// this site has no account system of its own — so the composer doubles as
// a passwordless sign-in: enter an email, get a magic link, come back
// signed in via Supabase auth's own session handling.
function renderComposer() {
  const el = document.getElementById("comment-composer");
  if (!el) return;

  if (currentSession) {
    el.innerHTML = `
      <form id="comment-form" class="comment-form">
        <textarea class="comment-textarea" id="comment-body" rows="3" placeholder="Add a comment…" required></textarea>
        <div class="comment-form-actions">
          <span class="comment-signed-in-as">Commenting as ${escapeHtml(currentSession.user.email || "you")}</span>
          <button type="submit" class="btn btn-primary">Post comment</button>
        </div>
        <p id="comment-error" class="comment-error" style="display:none;"></p>
      </form>
    `;
    document.getElementById("comment-form").addEventListener("submit", handleCommentSubmit);
  } else {
    el.innerHTML = `
      <form id="signin-form" class="signin-form">
        <p class="signin-hint">Sign in with email to leave a comment.</p>
        <div class="comment-form-actions">
          <input class="signin-email" id="signin-email" type="email" placeholder="you@example.com" required />
          <button type="submit" class="btn btn-primary">Email me a link</button>
        </div>
        <p id="signin-status" class="signin-status" style="display:none;"></p>
      </form>
    `;
    document.getElementById("signin-form").addEventListener("submit", handleSignInSubmit);
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const bodyEl = document.getElementById("comment-body");
  const errEl = document.getElementById("comment-error");
  const body = bodyEl.value.trim();
  errEl.style.display = "none";
  if (!body) return;

  const { error } = await supabase.from("comments").insert({
    clip_id: currentClip.id,
    user_id: currentSession.user.id,
    body
  });

  if (error) {
    errEl.textContent = error.message;
    errEl.style.display = "block";
    return;
  }

  bodyEl.value = "";
  loadComments();
}

async function handleSignInSubmit(e) {
  e.preventDefault();
  const emailEl = document.getElementById("signin-email");
  const statusEl = document.getElementById("signin-status");
  const email = emailEl.value.trim();
  if (!email) return;

  statusEl.style.display = "block";
  statusEl.textContent = "Sending…";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href }
  });

  statusEl.textContent = error ? error.message : "Check your email for a sign-in link.";
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  renderComposer();
});

document.getElementById("claim-cancel").addEventListener("click", () => {
  document.getElementById("claim-dialog").close();
});

document.getElementById("claim-submit").addEventListener("click", async () => {
  const name = document.getElementById("claim-name").value.trim();
  const email = document.getElementById("claim-email").value.trim();
  const reason = document.getElementById("claim-reason").value.trim();
  const errEl = document.getElementById("claim-error");
  errEl.style.display = "none";
  if (!name || !email || !reason) {
    errEl.textContent = "Please fill in every field.";
    errEl.style.display = "block";
    return;
  }
  const { error } = await supabase.from("claims").insert({
    clip_id: currentClip.id, claimant_name: name, claimant_email: email, reason
  });
  if (error) {
    errEl.textContent = error.message;
    errEl.style.display = "block";
    return;
  }
  document.getElementById("claim-dialog").close();
  alert("Claim submitted. The clip owner has been notified.");
  loadClip();
});

(async () => {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  loadClip();
})();