// Each entry is tied to docs/research/2026-09-06-live-read-adapter.md.
export const SCHOOL_ORIGIN = "https://zdbk.zju.edu.cn";
export const SELECTION_PATH = "/jwglxt/xsxk/zzxkghb_cxZzxkGhbIndex.html";
export const SELECTION_URL = `${SCHOOL_ORIGIN}${SELECTION_PATH}?gnmkdm=N253530&layout=default`;
export const READ_PATHS = {
  index: SELECTION_PATH,
  courses: "/jwglxt/xsxk/zzxkghb_cxZzxkGhbDdkcList.html",
  sections: "/jwglxt/xsxk/zzxkghb_cxZzxkGhbJxbList.html",
  chosen: "/jwglxt/xsxk/zzxkghb_cxZzxkGhbChoosed.html",
  weeks: "/jwglxt/xsxk/zzxkghb_cxZzxkDxqzcList.html",
} as const;
export function allowedRead(raw: string, method: string): boolean {
  const url = new URL(raw, SCHOOL_ORIGIN);
  if (url.origin !== SCHOOL_ORIGIN || url.username || url.password || url.hash)
    return false;
  if (
    [...url.searchParams.keys()].some((k) => !["gnmkdm", "layout"].includes(k))
  )
    return false;
  if (
    url.searchParams.has("gnmkdm") &&
    url.searchParams.get("gnmkdm") !== "N253530"
  )
    return false;
  return method === "GET"
    ? url.pathname === READ_PATHS.index
    : method === "POST" &&
        Object.entries(READ_PATHS).some(
          ([key, path]) => key !== "index" && path === url.pathname,
        );
}
export function allowedLogin(
  raw: string,
  method: string,
  resourceType: string,
): boolean {
  const url = new URL(raw),
    path = url.pathname.split(";")[0] ?? "";
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return false;
  if (url.hostname === "zjuam.zju.edu.cn")
    return ["GET", "POST"].includes(method) && path.startsWith("/cas/");
  if (url.origin !== SCHOOL_ORIGIN) return false;
  if (
    method === "GET" &&
    ["script", "stylesheet", "image", "font"].includes(resourceType)
  )
    return /\.(?:js|css|png|jpe?g|gif|svg|ico|woff2?|ttf)$/.test(path);
  if (method === "GET")
    return [
      SELECTION_PATH,
      "/jwglxt/xtgl/login_slogin.html",
      "/jwglxt/xtgl/login_ssologin.html",
      "/jwglxt/xtgl/index_initMenu.html",
      "/jwglxt/xtgl/login_getPublicKey.html",
    ].includes(path);
  return method === "POST" && path === "/jwglxt/xtgl/login_cxSsoLoginUrl.html";
}
