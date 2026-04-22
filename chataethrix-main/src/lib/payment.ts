const PREVIEW_TOKEN_PARAM = "__lovable_token";

export const PAYMENT_REQUEST_TIMEOUT_MS = 15000;

const getPreviewToken = () => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PREVIEW_TOKEN_PARAM);
};

export const buildPricingRedirectUrl = () => {
  const url = new URL("/pricing", window.location.origin);
  const previewToken = getPreviewToken();

  if (previewToken) {
    url.searchParams.set(PREVIEW_TOKEN_PARAM, previewToken);
  }

  return url.toString();
};

export const buildPricingCleanupUrl = () => {
  const url = new URL("/pricing", window.location.origin);
  const previewToken = getPreviewToken();

  if (previewToken) {
    url.searchParams.set(PREVIEW_TOKEN_PARAM, previewToken);
  }

  return `${url.pathname}${url.search}`;
};