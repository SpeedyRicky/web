// ClipNoter — public clip landing page logic.
// Reads the clip by slug and renders it into the .clip-card component
// (the same one the homepage uses for its preview), then wires up
// comments (magic-link sign-in required, per the "authenticated users
// can comment" RLS policy) and the "Report a complaint / issue" dialog,
// which inserts directly into `claims` with the anon key via the "anyone
// can file a claim" RLS policy — no account needed for that. A copyright
// claim (claim_type: "copyright_ownership") stays public per the DMCA
// policy; any other report (claim_type: "content_concern") is private —
// a database trigger emails cliproots@gmail.com but never posts publicly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// escapeHtml() alone doesn't stop a javascript: URL from reaching an
// href attribute — only http(s) URLs are ever allowed through here.
function safeHref(url) {
  try {
    const parsed = new URL(url, location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "#";
  } catch {
    return "#";
  }
}

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
let currentProfile = null;

// A signed-in session alone isn't enough to comment - every comment
// shows a username, and profiles.username is unique, so we need an
// actual row in `profiles` for this auth user before an insert into
// `comments` (FK'd to profiles, not auth.users) can succeed anyway.
// Same email can only ever back one auth user, but nothing stopped
// that one account from commenting with no visible identity at all -
// this makes picking a username a one-time, unskippable step for a
// brand-new account instead.
async function loadCurrentProfile() {
  if (!currentSession) {
    currentProfile = null;
    return;
  }
  const { data } = await supabase
    .from("profiles").select("*").eq("id", currentSession.user.id).maybeSingle();
  currentProfile = data || null;
}

async function loadClip() {
  if (!slug) {
    container.innerHTML = `<p class="clip-not-found">No clip specified.</p>`;
    return;
  }
  const { data, error } = await supabase.from("clips_feed").select("*").eq("slug", slug).single();
  // PGRST116 = "no rows" from .single() — that's a real "not found".
  // Any other error is a transient/network/DB problem, not a missing clip.
  if (error && error.code !== "PGRST116") {
    container.innerHTML = `<p class="clip-not-found">Something went wrong loading this clip. Try refreshing the page.</p>`;
    return;
  }
  if (!data) {
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
  const sourceHref = safeHref(isVideo ? withStartTime(data.source_url, data.video_start_seconds) : data.source_url);

  container.innerHTML = `
    <div class="clip-card">
      <div class="clip-card-bar">
        <span>CLIP ${escapeHtml((data.slug || "").slice(0, 8).toUpperCase())}</span>
        <span>SAVED</span>
      </div>
      <div class="clip-card-body">
        <div class="clip-author">
          <span class="clip-avatar">${initials(data.author_display_name || data.author_username)}</span>
          <span><b>${escapeHtml(data.author_display_name || data.author_username)}</b> · <a class="profile-link" href="profiles.html?username=${encodeURIComponent(data.author_username)}">@${escapeHtml(data.author_username)}</a></span>
        </div>
        ${claimBanner}
        ${quoteBlock}
        ${data.commentary ? `<p class="clip-card-row" style="display:block;">${escapeHtml(data.commentary)}</p>` : ""}
        <div class="clip-source">
          <span>${escapeHtml(data.source_domain || "")}</span>
          <a href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener">${isVideo ? "Watch clip ↗" : "View original ↗"}</a>
        </div>
        <div class="clip-published">Published ${new Date(data.created_at).toLocaleString()}</div>
        <div class="clip-claim-row"><button class="btn btn-ghost" id="open-claim" type="button">Report a complaint / issue</button></div>
      </div>
    </div>

    <section class="section comments-section" id="comments">
      <div class="section-head" style="margin-bottom:20px;">
        <h2 class="display" style="font-size:19px;">Comments</h2>
        <p>Discuss this clip with the ClipRoots community.</p>
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

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

async function loadComments() {
  const { data, error } = await supabase
    .from("comments")
    .select("id, user_id, body, created_at, is_system, profiles(username, display_name)")
    .eq("clip_id", currentClip.id)
    .order("created_at", { ascending: true });
  const listEl = document.getElementById("comments-list");
  if (error) {
    listEl.innerHTML = `<p class="comments-empty">Couldn't load comments.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    listEl.innerHTML = `<p class="comments-empty">No comments yet — be the first to say something.</p>`;
    return;
  }
  listEl.innerHTML = data.map((c) => {
    if (c.is_system) {
      return `
        <div class="comment comment-system">
          <div class="comment-head">
            <span class="comment-avatar comment-avatar-system">⚑</span>
            <span class="comment-author">ClipRoots Moderation</span>
            <span class="comment-time">${timeAgo(c.created_at)}</span>
          </div>
          <p class="comment-body">${escapeHtml(c.body)}</p>
        </div>
      `;
    }
    const name = c.profiles?.display_name || c.profiles?.username || "someone";
    const isOwn = currentSession && c.user_id === currentSession.user.id;
    return `
      <div class="comment" data-comment-id="${escapeHtml(c.id)}">
        <div class="comment-head">
          <span class="comment-avatar">${initials(name)}</span>
          <span class="comment-author">${escapeHtml(name)}</span>
          <span class="comment-time">${timeAgo(c.created_at)}</span>
          ${isOwn ? `<button class="comment-delete" type="button" data-comment-id="${escapeHtml(c.id)}" aria-label="Delete this comment">Delete</button>` : ""}
        </div>
        <p class="comment-body">${escapeHtml(c.body)}</p>
      </div>
    `;
  }).join("");
}

async function handleDeleteComment(commentId) {
  if (!currentSession) return;
  if (!confirm("Delete this comment? This cannot be undone.")) return;

  const commentEl = document.querySelector(`.comment[data-comment-id="${CSS.escape(commentId)}"]`);
  const btn = commentEl?.querySelector(".comment-delete");
  if (btn) btn.disabled = true;

  try {
    const { error } = await supabase
      .from("comments").delete()
      .eq("id", commentId).eq("user_id", currentSession.user.id);
    if (error) throw error;
    loadComments();
  } catch (e) {
    if (btn) btn.disabled = false;
    alert(e.message || "Couldn't delete this comment. Try again.");
  }
}

document.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest(".comment-delete");
  if (deleteBtn) handleDeleteComment(deleteBtn.dataset.commentId);
});


// Comments require an authenticated user (RLS: auth.uid() = user_id), and
// this site has no account system of its own — so the composer doubles as
// a passwordless sign-in: enter an email, get a magic link, come back
// signed in via Supabase auth's own session handling. A session alone
// isn't enough to post, though - a brand-new account has no `profiles`
// row yet (nothing creates one on sign-in), so the composer asks for a
// username first and creates that row before showing the comment box.
function renderComposer() {
  const el = document.getElementById("comment-composer");
  if (!el) return;

  if (currentSession && currentProfile) {
    el.innerHTML = `
      <form id="comment-form" class="comment-form">
        <textarea class="comment-textarea" id="comment-body" rows="3" placeholder="Add a comment…" required></textarea>
        <div class="comment-form-actions">
          <span class="comment-signed-in-as">Commenting as @${escapeHtml(currentProfile.username)}</span>
          <button type="submit" class="btn btn-primary">Post comment</button>
        </div>
        <p id="comment-error" class="comment-error" style="display:none;"></p>
      </form>
    `;
    document.getElementById("comment-form").addEventListener("submit", handleCommentSubmit);
  } else if (currentSession) {
    el.innerHTML = `
      <form id="username-form" class="signin-form">
        <p class="signin-hint">One more step - pick a username so people know who's commenting. This is a one-time setup for this account.</p>
        <div class="comment-form-actions">
          <input class="signin-email" id="username-input" type="text" placeholder="username" maxlength="30" required />
          <button type="submit" class="btn btn-primary">Save and comment</button>
        </div>
        <p id="username-error" class="comment-error" style="display:none;"></p>
      </form>
    `;
    document.getElementById("username-form").addEventListener("submit", handleUsernameSubmit);
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

async function handleUsernameSubmit(e) {
  e.preventDefault();
  const inputEl = document.getElementById("username-input");
  const errEl = document.getElementById("username-error");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const username = inputEl.value.trim();
  errEl.style.display = "none";

  if (!username || /\s/.test(username)) {
    errEl.textContent = "Username can't be empty or contain spaces.";
    errEl.style.display = "block";
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  try {
    const { error } = await supabase.from("profiles").insert({
      id: currentSession.user.id,
      username
    });
    if (error) {
      // 23505 = unique_violation - someone already has this username.
      errEl.textContent = error.code === "23505"
        ? "That username is taken - try another."
        : (error.message || "Couldn't save that username. Try again.");
      errEl.style.display = "block";
      return;
    }
    await loadCurrentProfile();
    renderComposer();
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const bodyEl = document.getElementById("comment-body");
  const errEl = document.getElementById("comment-error");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const body = bodyEl.value.trim();
  errEl.style.display = "none";
  if (!body) return;

  if (submitBtn) submitBtn.disabled = true;
  try {
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
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleSignInSubmit(e) {
  e.preventDefault();
  const emailEl = document.getElementById("signin-email");
  const statusEl = document.getElementById("signin-status");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const email = emailEl.value.trim();
  if (!email) return;

  statusEl.style.display = "block";
  statusEl.textContent = "Sending…";
  if (submitBtn) submitBtn.disabled = true;

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href }
    });

    statusEl.textContent = error ? error.message : "Check your email for a sign-in link.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  currentSession = session;
  await loadCurrentProfile();
  renderComposer();
});

document.getElementById("claim-cancel").addEventListener("click", () => {
  document.getElementById("claim-dialog").close();
});

// A copyright/rights claim keeps the public "under review" flow our DMCA
// policy describes (RLS-enforced trigger posts a system comment and flips
// claim_status). Anything else ("content_concern") is a private report -
// the trigger skips every public side effect for that type, so it's only
// ever visible to us (an automatic email) and, per existing RLS, the
// clip's own owner - never to other visitors.
document.getElementById("claim-submit").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const claimType = document.getElementById("claim-type").value;
  const name = document.getElementById("claim-name").value.trim();
  const email = document.getElementById("claim-email").value.trim();
  const reason = document.getElementById("claim-reason").value.trim();
  const errEl = document.getElementById("claim-error");
  errEl.style.display = "none";
  if (!claimType) {
    errEl.textContent = "Please choose what this report is about.";
    errEl.style.display = "block";
    return;
  }
  if (!name || !email || !reason) {
    errEl.textContent = "Please fill in every field.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    const { error } = await supabase.from("claims").insert({
      clip_id: currentClip.id, claim_type: claimType, claimant_name: name, claimant_email: email, reason
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = "block";
      return;
    }
    document.getElementById("claim-dialog").close();
    document.getElementById("claim-type").value = "";
    document.getElementById("claim-name").value = "";
    document.getElementById("claim-email").value = "";
    document.getElementById("claim-reason").value = "";
    alert(claimType === "copyright_ownership"
      ? "Report submitted. The clip owner has been notified, and the clip is now marked under review."
      : "Report submitted privately. Our team will take a look — thanks for flagging this.");
    loadClip();
  } finally {
    btn.disabled = false;
  }
});

(async () => {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  await loadCurrentProfile();
  loadClip();
})();
