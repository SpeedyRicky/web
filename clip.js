    // import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
    // const cfg = window.MARGINAL_CONFIG;
    // const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    // const params = new URLSearchParams(location.search);
    // const slug = params.get("slug");
    // const container = document.getElementById("container");

    // function escapeHtml(str) {
    //   return (str || "").replace(/[&<>"']/g, (c) => ({
    //     "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    //   }[c]));
    // }
    // function initials(name) { return (name || "?").trim().slice(0, 2).toUpperCase(); }

    // let currentClip = null;

    // async function loadClip() {
    //   if (!slug) {
    //     container.innerHTML = `<p class="empty">No clip specified.</p>`;
    //     return;
    //   }
    //   const { data, error } = await supabase.from("clips_feed").select("*").eq("slug", slug).single();
    //   if (error || !data) {
    //     container.innerHTML = `<p class="empty">This clip doesn't exist or was removed.</p>`;
    //     return;
    //   }
    //   currentClip = data;
    //   const claimBanner = data.claim_status === "filed"
    //     ? `<div class="claim-banner">⚠️ A rights claim has been filed on this clip. It is under review.</div>` : "";

    //   container.innerHTML = `
    //     <div class="card">
    //       <div class="author-row">
    //         <span class="avatar">${initials(data.author_display_name || data.author_username)}</span>
    //         ${escapeHtml(data.author_display_name || data.author_username)} · @${escapeHtml(data.author_username)}
    //       </div>
    //       ${claimBanner}
    //       <blockquote class="quote">"${escapeHtml(data.quoted_text)}"</blockquote>
    //       ${data.commentary ? `<div class="commentary">${escapeHtml(data.commentary)}</div>` : ""}
    //       <div class="source-box">
    //         <span>Source: ${escapeHtml(data.source_domain || "")}</span>
    //         <a href="${escapeHtml(data.source_url)}" target="_blank" rel="noopener">View original ↗</a>
    //       </div>
    //       <div class="meta">Published ${new Date(data.created_at).toLocaleString()}</div>
    //       <button class="btn claim" id="open-claim">🚩 File a claim</button>
    //     </div>

    //     <div class="comments-section">
    //       <h3 style="font-size:15px;">Comments</h3>
    //       <div id="comments-list"></div>
    //     </div>
    //   `;

    //   document.getElementById("open-claim").addEventListener("click", () => {
    //     document.getElementById("claim-dialog").showModal();
    //   });

    //   loadComments();
    // }

    // async function loadComments() {
    //   const { data, error } = await supabase
    //     .from("comments")
    //     .select("body, created_at, profiles(username, display_name)")
    //     .eq("clip_id", currentClip.id)
    //     .order("created_at", { ascending: true });
    //   const listEl = document.getElementById("comments-list");
    //   if (error) {
    //     listEl.innerHTML = `<p class="empty">Couldn't load comments.</p>`;
    //     return;
    //   }
    //   if (!data || data.length === 0) {
    //     listEl.innerHTML = `<p class="empty">No comments yet.</p>`;
    //     return;
    //   }
    //   listEl.innerHTML = data.map((c) => `
    //     <div class="comment">
    //       <span class="who">${escapeHtml(c.profiles?.display_name || c.profiles?.username || "someone")}</span>
    //       ${escapeHtml(c.body)}
    //     </div>
    //   `).join("");
    // }

    // document.getElementById("claim-cancel").addEventListener("click", () => {
    //   document.getElementById("claim-dialog").close();
    // });

    // document.getElementById("claim-submit").addEventListener("click", async () => {
    //   const name = document.getElementById("claim-name").value.trim();
    //   const email = document.getElementById("claim-email").value.trim();
    //   const reason = document.getElementById("claim-reason").value.trim();
    //   const errEl = document.getElementById("claim-error");
    //   errEl.style.display = "none";
    //   if (!name || !email || !reason) {
    //     errEl.textContent = "Please fill in every field.";
    //     errEl.style.display = "block";
    //     return;
    //   }
    //   const { error } = await supabase.from("claims").insert({
    //     clip_id: currentClip.id, claimant_name: name, claimant_email: email, reason
    //   });
    //   if (error) {
    //     errEl.textContent = error.message;
    //     errEl.style.display = "block";
    //     return;
    //   }
    //   document.getElementById("claim-dialog").close();
    //   alert("Claim submitted. The clip owner and moderators have been notified.");
    //   loadClip();
    // });

    // loadClip();




    // ClipNoter — public clip landing page logic.
// Split out of clip.html per the project's file layout (markup vs.
// behavior). Reads the clip by slug, renders it, and wires up the
// "File a claim" dialog — which inserts directly into `claims` with
// the anon key via the "anyone can file a claim" RLS policy, so a
// rights holder never needs a ClipNoter account to use it.

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

let currentClip = null;

async function loadClip() {
  if (!slug) {
    container.innerHTML = `<p class="empty">No clip specified.</p>`;
    return;
  }
  const { data, error } = await supabase.from("clips_feed").select("*").eq("slug", slug).single();
  if (error || !data) {
    container.innerHTML = `<p class="empty">This clip doesn't exist or was removed.</p>`;
    return;
  }
  currentClip = data;
  const claimBanner = data.claim_status === "filed"
    ? `<div class="claim-banner">⚠️ A rights claim has been filed on this clip. It is under review.</div>` : "";

  container.innerHTML = `
    <div class="card">
      <div class="author-row">
        <span class="avatar">${initials(data.author_display_name || data.author_username)}</span>
        ${escapeHtml(data.author_display_name || data.author_username)} · @${escapeHtml(data.author_username)}
      </div>
      ${claimBanner}
      <blockquote class="quote">"${escapeHtml(data.quoted_text)}"</blockquote>
      ${data.commentary ? `<div class="commentary">${escapeHtml(data.commentary)}</div>` : ""}
      <div class="source-box">
        <span>Source: ${escapeHtml(data.source_domain || "")}</span>
        <a href="${escapeHtml(data.source_url)}" target="_blank" rel="noopener">View original ↗</a>
      </div>
      <div class="meta">Published ${new Date(data.created_at).toLocaleString()}</div>
      <button class="btn claim" id="open-claim">🚩 File a claim</button>
    </div>

    <div class="comments-section">
      <h3 style="font-size:15px;">Comments</h3>
      <div id="comments-list"></div>
    </div>
  `;

  document.getElementById("open-claim").addEventListener("click", () => {
    document.getElementById("claim-dialog").showModal();
  });

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
    listEl.innerHTML = `<p class="empty">Couldn't load comments.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    listEl.innerHTML = `<p class="empty">No comments yet.</p>`;
    return;
  }
  listEl.innerHTML = data.map((c) => `
    <div class="comment">
      <span class="who">${escapeHtml(c.profiles?.display_name || c.profiles?.username || "someone")}</span>
      ${escapeHtml(c.body)}
    </div>
  `).join("");
}

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

loadClip();
