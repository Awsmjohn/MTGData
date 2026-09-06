// supabaseClient.js — the URL and key below are your project's public,
// front-end-safe credentials (the "publishable"/"anon" key), not secrets.
// Never put the "service_role"/"secret" key here or anywhere in this app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ixnrxzluhcezfbrjrcmv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yDYJvt1DYpFJFlYAKFXkvA_g1VWn7SJ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
