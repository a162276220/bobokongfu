import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { serveSite } from "./adapter.mjs";
import { requireUser } from "./auth.mjs";
import { handleApp } from "./handler.mjs";

// 宿主注入：数据客户端用平台的 Supabase 适配器，身份用网关校验过的 requireUser。
Deno.serve(serveSite((ctx) => handleApp({ request: ctx.request, db: ctx.supabase, getUser: requireUser }), {
  createClient,
  env: (name: string) => Deno.env.get(name),
}));