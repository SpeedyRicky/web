// ClipRoots — public profile page logic.
// Reads a profile by username, shows its public clips, and lets a
// signed-in viewer follow/unfollow it. Following writes directly to
// the existing `follows` table (RLS: "users can follow/unfollow as
// themselves") - no new schema needed, that table already carries the
// relationship end to end. Sign-in reuses the exact same magic-link
// email flow as clip.js's comment composer, since following someone
// is gated by the same "must be an authenticated user" requirement.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.MARGINAL_CONFIG;
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const params = new URLSearchParams(location.search);
const username = params.get("username");
const container = document.getElementById("container");

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function initials(name) { return (name || "?").trim().slice(0, 2).toUpperCase(); }

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

let currentSession = null;
let currentViewerProfile = null;
let profile = null;
let isFollowing = false;
let followerCount = 0;
let followingCount = 0;

// Same handoff as clip.js's comment composer: the sign-in form below
// collects and verifies a username against the email up front, but a
// brand-new account has nothing to verify against yet, so the typed
// username is stashed here and claimed once that account's first
// session shows up with no profile row.
const PENDING_USERNAME_KEY = "cliproots_pending_username";

// A signed-in session alone isn't enough to follow someone - the same
// email can only ever back one auth account, but that account has no
// visible identity (no `profiles` row) until it picks a username, so
// this makes that a one-time, unskippable step before the Follow
// button appears, the same way clip.js gates commenting.
async function loadCurrentViewerProfile() {
  if (!currentSession) {
    currentViewerProfile = null;
    return;
  }
  const { data } = await supabase
    .from("profiles").select("*").eq("id", currentSession.user.id).maybeSingle();
  if (data) {
    currentViewerProfile = data;
    return;
  }

  const pending = localStorage.getItem(PENDING_USERNAME_KEY);
  if (pending) {
    localStorage.removeItem(PENDING_USERNAME_KEY);
    const { data: created, error } = await supabase
      .from("profiles").insert({ id: currentSession.user.id, username: pending }).select().single();
    if (!error) {
      currentViewerProfile = created;
      return;
    }
  }
  currentViewerProfile = null;
}

async function loadProfile() {
  if (!username) {
    container.innerHTML = `<p class="clip-not-found">No profile specified.</p>`;
    return;
  }

  const { data, error } = await supabase.from("profiles").select("*").eq("username", username).single();
  if (error && error.code !== "PGRST116") {
    container.innerHTML = `<p class="clip-not-found">Something went wrong loading this profile. Try refreshing the page.</p>`;
    return;
  }
  if (!data) {
    container.innerHTML = `<p class="clip-not-found">This profile doesn't exist.</p>`;
    return;
  }
  profile = data;

  const [followersRes, followingRes] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", profile.id),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", profile.id)
  ]);
  followerCount = followersRes.count || 0;
  followingCount = followingRes.count || 0;

  await loadCurrentViewerProfile();

  isFollowing = false;
  if (currentSession && currentSession.user.id !== profile.id) {
    const { data: existing } = await supabase
      .from("follows").select("follower_id")
      .eq("follower_id", currentSession.user.id).eq("following_id", profile.id)
      .maybeSingle();
    isFollowing = !!existing;
  }

  renderProfile();
  loadProfileClips();
}

function renderStats() {
  return `<span><b>${followerCount}</b> follower${followerCount === 1 ? "" : "s"}</span><span><b>${followingCount}</b> following</span>`;
}

function renderProfile() {
  container.innerHTML = `
    <div class="card profile-card-view">
      <div class="profile-header">
        <span class="avatar profile-avatar-lg">${initials(profile.display_name || profile.username)}</span>
        <div>
          <h1 class="profile-name">${escapeHtml(profile.display_name || profile.username)}</h1>
          <div class="profile-username">@${escapeHtml(profile.username)}</div>
        </div>
      </div>
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      <div class="profile-stats" id="profile-stats">${renderStats()}</div>
      <div id="follow-action"></div>
    </div>

    <section class="section" id="profile-clips-section">
      <div class="section-head" style="margin-bottom:20px;">
        <h2 class="display" style="font-size:19px;">Public clips</h2>
      </div>
      <div class="activity-list" id="profile-clips">
        <p class="feed-state">Loading…</p>
      </div>
    </section>
  `;
  renderFollowAction();
}

function renderFollowAction() {
  const el = document.getElementById("follow-action");
  if (!el) return;

  const isSelf = currentSession && currentSession.user.id === profile.id;
  if (isSelf) {
    el.innerHTML = `<p class="signin-hint">This is your profile.</p>`;
    return;
  }

  if (!currentSession) {
    el.innerHTML = `
      <form id="signin-form" class="signin-form">
        <p class="signin-hint">Sign in with your email and username to follow ${escapeHtml(profile.display_name || profile.username)}.</p>
        <div class="comment-form-actions">
          <input class="signin-email" id="signin-email" type="email" placeholder="you@example.com" required />
          <input class="signin-email" id="signin-username" type="text" placeholder="username" maxlength="30" required />
          <button type="submit" class="btn btn-primary">Email me a link</button>
        </div>
        <p id="signin-status" class="signin-status" style="display:none;"></p>
        <div id="signin-mismatch" style="display:none;"></div>
      </form>
    `;
    document.getElementById("signin-form").addEventListener("submit", handleSignInSubmit);
    return;
  }

  if (!currentViewerProfile) {
    el.innerHTML = `
      <form id="username-form" class="signin-form">
        <p class="signin-hint">One more step - pick a username so people know who's following them. This is a one-time setup for this account.</p>
        <div class="comment-form-actions">
          <input class="signin-email" id="username-input" type="text" placeholder="username" maxlength="30" required />
          <button type="submit" class="btn btn-primary">Save and follow</button>
        </div>
        <p id="username-error" class="comment-error" style="display:none;"></p>
      </form>
    `;
    document.getElementById("username-form").addEventListener("submit", handleUsernameSubmit);
    return;
  }

  // "Following" swaps to "Unfollow" on hover/focus so it reads as an
  // action, not just a status label - the click behavior (toggle) was
  // already an unfollow, this just makes that obvious at a glance.
  el.innerHTML = `
    <button class="btn ${isFollowing ? "btn-ghost follow-btn-following" : "btn-primary"}" id="follow-btn" type="button">
      <span class="follow-btn-label">${isFollowing ? "Following ✓" : "Follow"}</span>
    </button>
    <p id="follow-error" class="comment-error" style="display:none;"></p>
  `;
  const followBtn = document.getElementById("follow-btn");
  followBtn.addEventListener("click", handleFollowToggle);
  if (isFollowing) {
    const label = followBtn.querySelector(".follow-btn-label");
    followBtn.addEventListener("mouseenter", () => { label.textContent = "Unfollow"; });
    followBtn.addEventListener("mouseleave", () => { label.textContent = "Following ✓"; });
    followBtn.addEventListener("focus", () => { label.textContent = "Unfollow"; });
    followBtn.addEventListener("blur", () => { label.textContent = "Following ✓"; });
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
    await loadCurrentViewerProfile();
    renderFollowAction();
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleFollowToggle() {
  const btn = document.getElementById("follow-btn");
  const errEl = document.getElementById("follow-error");
  errEl.style.display = "none";
  btn.disabled = true;

  try {
    if (isFollowing) {
      const { error } = await supabase.from("follows").delete()
        .eq("follower_id", currentSession.user.id).eq("following_id", profile.id);
      if (error) throw error;
      isFollowing = false;
      followerCount = Math.max(0, followerCount - 1);
    } else {
      const { error } = await supabase.from("follows").insert({
        follower_id: currentSession.user.id, following_id: profile.id
      });
      if (error) throw error;
      isFollowing = true;
      followerCount += 1;
    }
    document.getElementById("profile-stats").innerHTML = renderStats();
    renderFollowAction();
  } catch (e) {
    errEl.textContent = e.message || "Couldn't update. Try again.";
    errEl.style.display = "block";
  } finally {
    const freshBtn = document.getElementById("follow-btn");
    if (freshBtn) freshBtn.disabled = false;
  }
}

async function sendSignInLink(email, statusEl) {
  statusEl.style.display = "block";
  statusEl.textContent = "Sending…";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href }
  });
  statusEl.textContent = error ? error.message : "Email sent, check your email to sign in.";
}

function renderSignInMismatch(mismatchEl, statusEl, email, usernames) {
  statusEl.style.display = "none";
  mismatchEl.style.display = "block";
  mismatchEl.innerHTML = `
    <p class="comment-error">That username isn't linked to this email.</p>
    <button type="button" class="btn btn-ghost signin-show-accounts">Show accounts</button>
    <div class="signin-accounts-list"></div>
  `;
  mismatchEl.querySelector(".signin-show-accounts").addEventListener("click", (ev) => {
    ev.target.style.display = "none";
    mismatchEl.querySelector(".signin-accounts-list").innerHTML = usernames.map((u) =>
      `<button type="button" class="btn btn-ghost signin-account-btn" data-username="${escapeHtml(u)}">@${escapeHtml(u)}</button>`
    ).join("");
  });
  mismatchEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".signin-account-btn");
    if (!btn) return;
    mismatchEl.style.display = "none";
    await sendSignInLink(email, statusEl);
  });
}

async function handleSignInSubmit(e) {
  e.preventDefault();
  const emailEl = document.getElementById("signin-email");
  const usernameEl = document.getElementById("signin-username");
  const statusEl = document.getElementById("signin-status");
  const mismatchEl = document.getElementById("signin-mismatch");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const email = emailEl.value.trim();
  const username = usernameEl.value.trim();
  if (!email || !username) return;

  statusEl.style.display = "block";
  statusEl.textContent = "Checking…";
  mismatchEl.style.display = "none";
  if (submitBtn) submitBtn.disabled = true;

  try {
    const { data: matches, error: rpcError } = await supabase.rpc("usernames_for_email", { p_email: email });
    if (rpcError) {
      statusEl.textContent = rpcError.message || "Something went wrong. Try again.";
      return;
    }

    const usernames = (matches || []).map((r) => r.username);
    if (usernames.length === 0) {
      localStorage.setItem(PENDING_USERNAME_KEY, username);
      await sendSignInLink(email, statusEl);
      return;
    }
    if (usernames.some((u) => u.toLowerCase() === username.toLowerCase())) {
      await sendSignInLink(email, statusEl);
      return;
    }
    renderSignInMismatch(mismatchEl, statusEl, email, usernames);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadProfileClips() {
  const el = document.getElementById("profile-clips");
  const { data, error } = await supabase
    .from("clips_feed").select("*")
    .eq("author_id", profile.id).eq("is_private", false)
    .order("created_at", { ascending: false }).limit(30);

  if (error) {
    el.innerHTML = `<p class="feed-state">Couldn't load this person's clips.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="feed-state">No public clips yet.</p>`;
    return;
  }

  el.innerHTML = data.map((c) => {
    const isVideo = c.clip_type === "video";
    const body = isVideo
      ? `<span class="activity-video-tag">▶ ${formatClipTime(c.video_start_seconds)} – ${formatClipTime(c.video_end_seconds)}</span><p>${escapeHtml(c.commentary || "video clip")}</p>`
      : `<p>"${escapeHtml((c.quoted_text || "").slice(0, 140))}${(c.quoted_text || "").length > 140 ? "…" : ""}"</p>`;
    const dateStr = new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase();
    return `
      <a class="activity-entry" href="clip.html?slug=${encodeURIComponent(c.slug)}">
        <div class="activity-date">${dateStr}</div>
        <div class="activity-body">${body}</div>
        <div class="activity-meta">${isVideo ? "Video clip" : "Text clip"}<span class="src">${escapeHtml(c.source_domain || "web")}</span></div>
      </a>
    `;
  }).join("");
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  if (profile) loadProfile();
});

(async () => {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  loadProfile();
})();
