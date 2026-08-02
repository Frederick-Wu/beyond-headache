-- 「頭痛之外」瀏覽計數器 — Supabase 一次性設定
--
-- 使用方式：Supabase Dashboard → 左側 SQL Editor → New query → 貼上整份 → Run
-- 重複執行是安全的（全部都有 if not exists / or replace）。

-- ---------------------------------------------------------------
-- 1. 資料表：一列一個頁面
-- ---------------------------------------------------------------
create table if not exists public.page_views (
  slug        text primary key,
  views       bigint      not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.page_views is '每個頁面（含首頁）的累計瀏覽次數';

-- ---------------------------------------------------------------
-- 2. RLS：匿名訪客只能「讀」，不能直接改數字
-- ---------------------------------------------------------------
alter table public.page_views enable row level security;

drop policy if exists "anyone can read view counts" on public.page_views;
create policy "anyone can read view counts"
  on public.page_views
  for select
  to anon, authenticated
  using (true);

-- 刻意不建立 insert / update / delete 政策。
-- 加一寫入只能透過下面那個 security definer 函式，訪客沒辦法把數字改成任意值。

-- ---------------------------------------------------------------
-- 3. 加一的函式（單一 SQL 敘述，原子操作，不會有 race condition）
-- ---------------------------------------------------------------
create or replace function public.increment_view(page_slug text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  -- 擋掉異常長度的 slug，避免被塞垃圾資料
  if page_slug is null or length(page_slug) = 0 or length(page_slug) > 200 then
    raise exception 'invalid slug';
  end if;

  insert into public.page_views as pv (slug, views, updated_at)
  values (page_slug, 1, now())
  on conflict (slug)
  do update set views = pv.views + 1, updated_at = now()
  returning pv.views into new_count;

  return new_count;
end;
$$;

revoke all on function public.increment_view(text) from public;
grant execute on function public.increment_view(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- 完成。驗證：
--   select public.increment_view('__test__');
--   select * from public.page_views;
--   delete from public.page_views where slug = '__test__';
-- ---------------------------------------------------------------
