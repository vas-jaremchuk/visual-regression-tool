/** Minimal 403 page the proxy returns before any app page streams (04 §3). */
export function forbiddenHtml(): string {
  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>403 · Visual Regression Tool</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117;color:#e5e7eb;font-family:system-ui,sans-serif}
main{max-width:28rem;padding:3rem;text-align:center}
h1{font-size:1.125rem;font-weight:500}
p{color:#9ca3af;font-size:.875rem}
a{color:#818cf8}
a:focus-visible{outline:2px solid #818cf8;outline-offset:2px}
</style>
</head>
<body>
<main role="alert">
<h1>403: You do not have access to this page</h1>
<p>Only project admins can change project settings. Ask a project admin if you need a change.</p>
<p><a href="/">Back to projects</a></p>
</main>
</body>
</html>
`;
}
