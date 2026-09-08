// clippy.js — talks to your own Supabase Edge Function (see
// supabase-clippy-chat-function.ts), which holds the real AI API key on the
// server. This file only ever sees your project's public URL and
// publishable key — both meant to be visible in front-end code — never the
// secret key itself.

const FUNCTION_URL = "https://ixnrxzluhcezfbrjrcmv.supabase.co/functions/v1/clippy-chat";
const PUBLISHABLE_KEY = "sb_publishable_yDYJvt1DYpFJFlYAKFXkvA_g1VWn7SJ";

async function ask(deckContext, message, history) {
  let res;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ deckContext, message, history }),
    });
  } catch (e) {
    throw new Error("Couldn't reach Clippy's backend — check your connection.");
  }
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok || data.error) {
    throw new Error(data.error || "Clippy couldn't respond right now — the Edge Function may not be deployed yet.");
  }
  return data.reply;
}

export const Clippy = { ask };
