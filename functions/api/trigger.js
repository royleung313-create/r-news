export async function onRequestPost(context) {
  const token = context.env.GITHUB_TOKEN;
  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: "尚未在 Cloudflare 設定 GITHUB_TOKEN" }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  try {
    const ghRes = await fetch(
      "https://api.github.com/repos/royleung313-create/r-news/actions/workflows/update-news.yml/dispatches",
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "User-Agent": "R-News-Cloudflare-Pages",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ref: "main" })
      }
    );

    if (ghRes.status === 204) {
      return new Response(
        JSON.stringify({ ok: true, message: "已成功叫醒 GitHub 後台開始重抓" }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const errText = await ghRes.text();
    return new Response(
      JSON.stringify({ ok: false, error: `GitHub 回應 ${ghRes.status}：${errText.slice(0, 120)}` }),
      { status: ghRes.status, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}
