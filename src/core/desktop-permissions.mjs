// The desktop window only ever loads the local CommBurn server (navigation and new windows are
// blocked), so its permission requests, such as reading installed fonts through
// window.queryLocalFonts, are granted. Requests from any other origin are denied.
export function isTrustedPermissionRequest(requestingUrl, trustedOrigin) {
  try {
    return new URL(requestingUrl).origin === trustedOrigin;
  } catch {
    return false;
  }
}
