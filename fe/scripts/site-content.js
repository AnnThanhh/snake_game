const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
export function publicOrigin(site) {
  try {
    const u = new URL(site?.origin);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      ? u.origin
      : "";
  } catch {
    return "";
  }
}
export function createSiteLoader(backend, { ttl = 60000 } = {}) {
  let cached = null,
    expires = 0,
    pending = null,
    lastSuccess = 0;
  return async () => {
    if (Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch(new URL("/api/site", backend), {
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) throw new Error("Site content unavailable");
        const data = await response.json();
        if (
          data.version !== 1 ||
          !data.site?.title ||
          !Array.isArray(data.site.pages) ||
          !Array.isArray(data.site.faq)
        )
          throw new Error("Invalid site contract");
        cached = data;
        lastSuccess = Date.now();
        expires = Date.now() + ttl;
        return cached;
      } catch {
        expires = Date.now() + 5000;
        if (Date.now() - lastSuccess >= 30 * 60000) cached = null;
        return cached;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}
export function seoResponse(pathname, template, content) {
  const site = content?.site,
    origin = publicOrigin(site),
    indexable = Boolean(origin && site?.indexable),
    robots = indexable
      ? "index, follow, max-image-preview:large"
      : "noindex, nofollow";
  if (!site && !["/admin.html", "/index.html"].includes(pathname))
    return {
      body: template || "Temporarily unavailable",
      type: template ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
      status: 503,
      cache: "no-store",
      retryAfter: 60,
    };
  if (pathname === "/robots.txt")
    return {
      type: "text/plain; charset=utf-8",
      body: indexable
        ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\nDisallow: /rt/\nSitemap: ${origin}/sitemap.xml\n`
        : "User-agent: *\nDisallow: /\n",
    };
  if (pathname === "/sitemap.xml")
    return {
      type: "application/xml; charset=utf-8",
      body:
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        (indexable
          ? ["/", ...site.pages.map((p) => "/" + p.slug + "/")]
              .map(
                (p) =>
                  `<url><loc>${escape(origin + p)}</loc>${Number.isFinite(Date.parse(content.updatedAt)) ? `<lastmod>${new Date(content.updatedAt).toISOString()}</lastmod>` : ""}</url>`,
              )
              .join("")
          : "") +
        "</urlset>",
    };
  if (pathname === "/index.html") return { redirect: "/" };
  if (pathname === "/admin.html")
    return {
      body: template.replace(
        "</head>",
        '<meta name="robots" content="noindex,nofollow"></head>',
      ),
      robots: "noindex, nofollow",
      cache: "no-store",
    };
  const page = site?.pages.find(
    (p) => pathname === "/" + p.slug + "/" || pathname === "/" + p.slug,
  );
  if (pathname !== "/" && !page) return null;
  if (page && !pathname.endsWith("/")) return { redirect: pathname + "/" };
  if (!site)
    return { body: template, status: 503, cache: "no-store", retryAfter: 60 };
  const title = page?.title || site.title,
    description = page?.description || site.description,
    canonical = origin ? origin + pathname : "",
    heading = page?.heading || site.heading;
  const nav = `<nav class="seo-links" aria-label="Khám phá game"><a href="/">Chơi Serpent Survivor</a>${site.pages.map((p) => `<a href="/${escape(p.slug)}/">${escape(p.heading)}</a>`).join("")}</nav>`;
  const faq = `<section class="seo-faq"><h2>Câu hỏi thường gặp</h2>${site.faq.map((f) => `<details><summary>${escape(f.question)}</summary><p>${escape(f.answer)}</p></details>`).join("")}</section>`;
  const sections = page
    ? page.sections
        .map(
          (s) =>
            `<section><h2>${escape(s.heading)}</h2><p>${escape(s.text)}</p></section>`,
        )
        .join("")
    : `<h2>${escape(site.heading)}</h2><p>${escape(site.introduction)}</p>${nav}${faq}`;
  const graph = page
    ? {
        "@type": "WebPage",
        name: title,
        description,
        inLanguage: site.language,
        ...(canonical ? { url: canonical } : {}),
      }
    : {
        "@type": "VideoGame",
        name: site.name,
        description,
        inLanguage: site.language,
        gamePlatform: "Web browser",
        applicationCategory: "Game",
        isAccessibleForFree: true,
        ...(canonical
          ? { url: canonical, image: origin + site.socialImage }
          : {}),
      };
  const metadata = `<meta name="description" content="${escape(description)}"><meta name="robots" content="${robots}">${canonical ? `<link rel="canonical" href="${escape(canonical)}">` : ""}<meta property="og:type" content="website"><meta property="og:site_name" content="${escape(site.name)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:locale" content="vi_VN">${origin ? `<meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(origin + site.socialImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escape(origin + site.socialImage)}">` : ""}<meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">${site.googleVerification ? `<meta name="google-site-verification" content="${escape(site.googleVerification)}">` : ""}<script type="application/ld+json">${json(
    {
      "@context": "https://schema.org",
      "@graph": [
        graph,
        {
          "@type": "WebSite",
          name: site.name,
          ...(origin ? { url: origin + "/" } : {}),
        },
        ...(page && origin
          ? [
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: site.name,
                    item: origin + "/",
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: heading,
                    item: canonical,
                  },
                ],
              },
            ]
          : []),
      ],
    },
  )}</script>`;
  if (page)
    return {
      body: `<!doctype html><html lang="${escape(site.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${metadata}<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/seo.css"><link rel="icon" href="/icon.svg"></head><body class="guide-body"><main class="guide-page"><a class="guide-brand" href="/">${escape(site.name)}</a>${nav}<h1>${escape(heading)}</h1><p class="guide-lead">${escape(description)}</p>${sections}<a class="primary-button guide-play" href="/">Vào chơi Serpent Survivor ↗</a>${nav}</main></body></html>`,
      robots,
      cache: "public, max-age=60",
    };
  const body = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      "</head>",
      metadata + '<link rel="stylesheet" href="/seo.css"></head>',
    )
    .replace('<main class="main">', '<main class="main">')
    .replace(
      "</main>",
      `<section class="seo-overview">${sections}</section></main>`,
    );
  return { body, robots, cache: "public, max-age=60" };
}
