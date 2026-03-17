// Cloudflare Workers - Notion API 프록시
// 환경변수 설정 필요:
//   NOTION_TOKEN = ntn_xxxxxxxxxx
//   NOTION_DATABASE_ID = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const ALLOWED_ORIGINS = [
  "https://www.notion.so",
  "https://notion.so",
  "https://notion.site",
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      if (url.pathname === "/events" && request.method === "GET") {
        const events = await fetchNotionEvents(env);
        return new Response(JSON.stringify(events), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
          },
        });
      }
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

async function fetchNotionEvents(env) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

  const body = {
    filter: {
      and: [
        { property: "날짜", date: { on_or_after: firstDay } },
        { property: "날짜", date: { on_or_before: lastDay } },
      ],
    },
    sorts: [{ property: "날짜", direction: "ascending" }],
    page_size: 100,
  };

  const response = await fetch(
    `${NOTION_API}/data_sources/${env.NOTION_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion API 오류: ${response.status}`);
  }

  const data = await response.json();

  // 이벤트 배열로 반환 (제목, 카테고리, 시작/종료일 포함)
  const events = [];

  for (const page of data.results) {
    const props = page.properties;

    const dateProp = props["날짜"];
    if (!dateProp || !dateProp.date || !dateProp.date.start) continue;

    const start = dateProp.date.start.split("T")[0];
    const end = dateProp.date.end ? dateProp.date.end.split("T")[0] : start;

    // 제목 파싱
    let title = "(제목 없음)";
    const titleProp = props["이름"] || props["제목"] || props["Name"];
    if (titleProp && titleProp.title && titleProp.title.length > 0) {
      title = titleProp.title[0].plain_text;
    }

    // 비고(카테고리) 파싱 - select 또는 rich_text
    let category = "일정";
    const bizgoProp = props["비고"];
    if (bizgoProp) {
      if (bizgoProp.select && bizgoProp.select.name) {
        category = bizgoProp.select.name;
      } else if (bizgoProp.rich_text && bizgoProp.rich_text.length > 0) {
        category = bizgoProp.rich_text[0].plain_text;
      }
    }

    events.push({ title, category, start, end });
  }

  return events;
  // 반환 예시:
  // [
  //   { title: "팀 미팅", category: "일정", start: "2024-03-11", end: "2024-03-13" },
  //   { title: "알고리즘", category: "공부", start: "2024-03-12", end: "2024-03-12" }
  // ]
}
