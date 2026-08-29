// ClipRoots — password reset landing page.
// Reached from the "Forgot password?" link in the extension, which calls
// supabase.auth.resetPasswordForEmail() with this page as the redirect
// target. Supabase's client SDK auto-detects the recovery session from
// the URL it's opened with (either the #access_token=...&type=recovery
// fragment, or a PKCE ?code=... it exchanges itself) and fires a
// PASSWORD_RECOVERY auth event once that's done - only then is it safe
// to call updateUser() with a new password. After that succeeds, the
// account's regular sign-in (email + new password, e.g. back in the
// extension) works immediately; there is no separate step here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.MARGINAL_CONFIG;
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const container = document.getElementById("container");

let settled = false;

function renderForm() {
  container.innerHTML = `
    <form id="reset-form" class="signin-form">
      <p class="signin-hint">Choose a new password for your ClipRoots account.</p>
      <input class="signin-email" id="reset-password-1" type="password" placeholder="New password" minlength="6" autocomplete="new-password" style="display:block; width:100%; margin-bottom:8px;" required />
      <input class="signin-email" id="reset-password-2" type="password" placeholder="Confirm new password" minlength="6" autocomplete="new-password" style="display:block; width:100%;" required />
      <div class="comment-form-actions">
        <span></span>
        <button type="submit" class="btn btn-primary">Set new password</button>
      </div>
      <p id="reset-error" class="comment-error" style="display:none;"></p>
    </form>
  `;
  document.getElementById("reset-form").addEventListener("submit", handleResetSubmit);
}

function renderInvalid() {
  container.innerHTML = `<p class="clip-not-found">This reset link is invalid or has expired. Go back to the ClipRoots extension and request a new one from "Forgot password?".</p>`;
}

function renderDone() {
  container.innerHTML = `<p class="signin-hint">Your password has been updated. Go back to the ClipRoots extension and log in with your new password.</p>`;
}

async function handleResetSubmit(e) {
  e.preventDefault();
  const p1 = document.getElementById("reset-password-1").value;
  const p2 = document.getElementById("reset-password-2").value;
  const errEl = document.getElementById("reset-error");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  errEl.style.display = "none";

  if (p1.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    errEl.style.display = "block";
    return;
  }
  if (p1 !== p2) {
    errEl.textContent = "Passwords don't match.";
    errEl.style.display = "block";
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) {
      errEl.textContent = error.message || "Couldn't update your password. Try again.";
      errEl.style.display = "block";
      return;
    }
    renderDone();
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function markReady(hasSession) {
  if (settled) return;
  settled = true;
  if (hasSession) renderForm();
  else renderInvalid();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
    markReady(true);
  }
});

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    markReady(true);
    return;
  }
  // The SDK may still be parsing the URL's recovery token - give it a
  // moment, then fall back to "invalid link" if still nothing.
  setTimeout(async () => {
    if (settled) return;
    const { data: retry } = await supabase.auth.getSession();
    markReady(!!retry.session);
  }, 1200);
})();
